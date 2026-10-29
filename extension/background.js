// Drives the polling loop and sends alerts. Timers live here rather than in the page because
// Chrome throttles timers in background tabs to once a minute; messages to the tab are not throttled.
const NTFY = 'https://ntfy.sh/';
const BUY_PAGES = 'https://www.apple.com/*shop/buy-iphone/*';
const BASE_MS = 10_000;
const JITTER_MS = 2_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const RELOAD_AFTER_FAILS = 3;
const MIN_RELOAD_GAP_MS = 5 * 60_000;
const HEALTHY_RELOAD_MS = 30 * 60_000; // refresh Apple's cookies now and then
const TAB_TIMEOUT_MS = 20_000;
const FAILING_WARN_MS = 5 * 60_000;
const GAP_MS = 2 * 60_000; // a check this late means the Mac slept or Chrome was paused
const VOICE_MAX_MS = 15 * 60_000;
const DEFAULT_CHANNELS = { chrome: true, voice: true, phone: false };

let timer = null;

const getState = () =>
  chrome.storage.local.get(['running', 'tabId', 'fails', 'failingSince', 'lastReloadAt', 'alerted', 'nextAt']);

async function getPrefs() {
  const p = await chrome.storage.local.get(['lang', 'channels', 'ntfyTopic']);
  const saved = p.channels || {};
  const channels = Object.fromEntries(Object.entries(DEFAULT_CHANNELS).map(([k, on]) => [k, k in saved ? saved[k] : on]));
  return { zh: p.lang === 'zh', channels, topic: p.ntfyTopic };
}

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(tick, ms);
}

function nextDelay(fails) {
  const base = fails ? Math.min(BASE_MS * 2 ** fails, MAX_BACKOFF_MS) : BASE_MS;
  return base + Math.round((Math.random() * 2 - 1) * JITTER_MS);
}

// ---------- alert channels ----------

function notifyChrome(title, message) {
  chrome.notifications.create('alert-' + Date.now(), {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority: 2,
    requireInteraction: true,
  });
}

// Speaks the text with the Mac's own voice, over and over, until stopVoice() or VOICE_MAX_MS.
let voiceUntil = 0;
function speak(text, zh, repeat) {
  voiceUntil = repeat ? Date.now() + VOICE_MAX_MS : 0;
  const once = () =>
    chrome.tts.speak(text, {
      lang: zh ? 'zh-CN' : 'en-US',
      volume: 1,
      onEvent: (e) => {
        if (e.type === 'end' && Date.now() < voiceUntil) setTimeout(() => Date.now() < voiceUntil && once(), 1200);
      },
    });
  once();
}

function stopVoice() {
  voiceUntil = 0;
  chrome.tts.stop();
}

function pushPhone(topic, title, message, url) {
  const body = { topic, title, message, priority: 5, tags: ['rotating_light'] };
  if (url) body.click = url;
  return fetch(NTFY, { method: 'POST', body: JSON.stringify(body) })
    .then((r) => r.ok)
    .catch(() => false);
}

async function alertFound(stores, tabId, model) {
  const { zh, channels, topic } = await getPrefs();
  const title = zh ? `🚨 ${model} 有货了！快去下单` : `🚨 ${model} is in stock! Go buy it`;
  const message = stores.map((x) => `${x.name} ${x.distance} — ${x.quote}`).join('\n');
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const url = tab ? tab.url : '';

  broadcast({ type: 'found' }); // every panel flashes either way
  if (channels.chrome) {
    notifyChrome(title, message);
    if (tab) {
      await chrome.windows.update(tab.windowId, { focused: true, drawAttention: true, state: 'normal' }).catch(() => {});
      await chrome.tabs.update(tabId, { active: true }).catch(() => {});
    }
  }
  if (channels.voice) {
    const spoken = model.replace(/\s*·\s*/g, ', ').replace(/"/g, ' inch');
    speak(zh ? `${spoken} 有货了！快去下单！` : `${spoken} is in stock! Go buy it now!`, zh, true);
  }
  if (channels.phone && topic) pushPhone(topic, title, message, url);
}

// Said once when checks have been failing for a while, so a silent panel isn't mistaken for "no stock".
async function warnFailing() {
  const { zh, channels } = await getPrefs();
  const text = zh
    ? '库存检查已经五分钟没成功了，可能被 Apple 暂时限制，扩展会自动重试。'
    : "Stock checks haven't worked for 5 minutes. Apple may be blocking them; the extension keeps retrying.";
  if (channels.chrome) notifyChrome('Pickup Alert for iPhone', text);
  if (channels.voice) speak(text, zh, false);
}

// Checks can't run while the Mac sleeps, so say how long they were paused once they're back.
async function reportGap(minutes) {
  await chrome.storage.local.set({ lastGap: { minutes, at: Date.now() } });
  const { zh, channels, topic } = await getPrefs();
  const text = zh
    ? `监控暂停了 ${minutes} 分钟（Mac 睡眠或 Chrome 被暂停），现在已恢复。`
    : `Monitoring was paused for ${minutes} min (Mac asleep or Chrome paused). It's running again.`;
  if (channels.phone && topic) pushPhone(topic, 'Pickup Alert for iPhone', text, '');
}

async function reportTabClosed() {
  const { zh, channels, topic } = await getPrefs();
  const text = zh
    ? '监控已停止：Apple 页面被关掉了。重新打开该页面即可继续。'
    : 'Monitoring stopped: the Apple page was closed. Open it again to resume.';
  if (channels.chrome) notifyChrome('Pickup Alert for iPhone', text);
  if (channels.phone && topic) pushPhone(topic, 'Pickup Alert for iPhone', text, '');
}

async function testChannel(channel) {
  const { zh, topic } = await getPrefs();
  const title = zh ? 'iPhone 取货提醒测试' : 'Pickup Alert for iPhone test';
  const message = zh ? '这是一条测试提醒，到货时会是这样。' : 'This is a test. A real alert looks like this.';
  if (channel === 'chrome') {
    notifyChrome(title, message);
    return new Promise((done) => chrome.notifications.getPermissionLevel((level) => done(level === 'granted')));
  }
  if (channel === 'voice') {
    speak(message, zh, false);
    return true;
  }
  if (channel === 'phone') return topic ? pushPhone(topic, title, message, '') : false;
  return false;
}

// ---------- polling ----------

// One tab (the "watcher", stored as tabId) runs the checks. Every open buy page shows the same
// panel, so results and status go to all of them.
const buyTabs = () => chrome.tabs.query({ url: BUY_PAGES }).catch(() => []);

async function broadcast(msg, exceptId) {
  for (const tab of await buyTabs()) {
    if (tab.id !== exceptId) chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
  }
}

async function statusAll() {
  const s = await getState();
  for (const tab of await buyTabs()) {
    chrome.tabs
      .sendMessage(tab.id, { type: 'status', running: !!s.running, nextAt: s.running ? s.nextAt : null, watcher: tab.id === s.tabId })
      .catch(() => {});
  }
}

async function makeWatcher(tabId) {
  await chrome.storage.local.set({ tabId, fails: 0, nextAt: null });
  chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});
  const s = await getState();
  if (s.running) schedule(1_000);
  statusAll();
}

function askTab(tabId) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, { type: 'check' }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Page not responding')), TAB_TIMEOUT_MS)),
  ]);
}

async function reloadTab(tabId) {
  await chrome.storage.local.set({ lastReloadAt: Date.now() });
  await chrome.tabs.reload(tabId).catch(() => {});
}

async function tick() {
  timer = null;
  const s = await getState();
  if (!s.running) return;
  chrome.power.requestKeepAwake('system'); // the screen may sleep, the Mac may not
  if (s.tabId == null) {
    badge('?', '#888');
    await chrome.storage.local.set({ nextAt: null });
    statusAll();
    return; // waits for a 'hello' from an open iPhone buy page
  }
  if (s.nextAt && Date.now() - s.nextAt > GAP_MS) await reportGap(Math.round((Date.now() - s.nextAt) / 60_000));

  let r;
  try {
    r = await askTab(s.tabId);
  } catch (e) {
    r = { ok: false, dead: true };
  }
  if (r && !r.dead) broadcast({ type: 'result', r }, s.tabId);
  const now = Date.now();
  let fails = s.fails || 0;
  let failingSince = s.failingSince || null;

  if (r && r.ok) {
    fails = 0;
    failingSince = null;
    const found = r.stores.filter((x) => x.available);
    const fresh = found.filter((x) => !(s.alerted || []).includes(x.id));
    await chrome.storage.local.set({ alerted: found.map((x) => x.id) });
    badge(found.length ? '!!!' : 'OK', found.length ? '#d00' : '#2a2');
    if (fresh.length) await alertFound(fresh, s.tabId, r.model);
    else if (now - (s.lastReloadAt || 0) > HEALTHY_RELOAD_MS && !found.length) await reloadTab(s.tabId);
  } else {
    fails += 1;
    badge('ERR', '#c60');
    if (!failingSince) failingSince = now;
    else if (failingSince > 0 && now - failingSince > FAILING_WARN_MS) {
      await warnFailing();
      failingSince = -1; // warned; stays quiet until a check works again
    }
    const sinceReload = now - (s.lastReloadAt || 0);
    // A dead tab gets a minute to finish loading before we reload it again.
    if ((r && r.dead && sinceReload > 60_000) || (fails >= RELOAD_AFTER_FAILS && sinceReload > MIN_RELOAD_GAP_MS)) {
      await reloadTab(s.tabId);
    }
  }

  const delay = nextDelay(fails);
  await chrome.storage.local.set({ fails, failingSince, nextAt: Date.now() + delay });
  schedule(delay);
  statusAll();
}

function badge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'hello' && sender.tab) {
    // A new buy page only takes over when no other tab is checking.
    getState().then(async (s) => {
      const current = s.tabId != null && (await chrome.tabs.get(s.tabId).catch(() => null));
      if (!current || s.tabId === sender.tab.id) return makeWatcher(sender.tab.id);
      statusAll();
    });
  } else if (msg.type === 'takeover' && sender.tab) {
    makeWatcher(sender.tab.id);
  } else if (msg.type === 'start') {
    chrome.storage.local
      .set({ running: true, fails: 0, failingSince: null, alerted: [], lastReloadAt: Date.now(), nextAt: null, lastGap: null })
      .then(() => (sender.tab ? makeWatcher(sender.tab.id) : schedule(0)));
  } else if (msg.type === 'stop') {
    clearTimeout(timer);
    timer = null;
    chrome.storage.local.set({ running: false, nextAt: null });
    chrome.power.releaseKeepAwake();
    stopVoice();
    badge('', '#888');
    statusAll();
  } else if (msg.type === 'reset') {
    chrome.storage.local.set({ alerted: [], fails: 0 }).then(() => timer && schedule(1_000));
  } else if (msg.type === 'ack') {
    stopVoice();
    broadcast({ type: 'ack' }, sender.tab && sender.tab.id);
  } else if (msg.type === 'test') {
    testChannel(msg.channel).then(reply);
    return true; // async reply
  }
});

// Clicking the notification brings the tab back and silences the alarm.
chrome.notifications.onClicked.addListener(async () => {
  stopVoice();
  const { tabId } = await getState();
  if (tabId == null) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) {
    chrome.windows.update(tab.windowId, { focused: true });
    chrome.tabs.update(tabId, { active: true });
  }
  broadcast({ type: 'ack' });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const s = await getState();
  if (tabId !== s.tabId) return;
  // Hand over to another open buy page if there is one; only warn when none is left.
  const next = (await buyTabs()).find((tab) => tab.id !== tabId);
  if (next) return makeWatcher(next.id);
  await chrome.storage.local.set({ tabId: null, nextAt: null });
  if (s.running) reportTabClosed();
});

// Chrome can shut down this service worker; the alarm wakes it up and restarts the loop.
chrome.alarms.create('watchdog', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async () => {
  const s = await getState();
  if (s.running && !timer) schedule(0);
});
