// Drives the polling loops and sends alerts. Every Apple tab is its own independent watch: its own
// model, schedule, backoff and alerts. Timers live here rather than in the pages because Chrome
// throttles timers in background tabs to once a minute; messages to a tab are not throttled.
const NTFY = 'https://ntfy.sh/';
const NAME = 'Pickup Alert for iPhone';
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
const WARN_EVERY_MS = 60 * 60_000; // problem warnings: at most one an hour per tab
const DEFAULT_CHANNELS = { chrome: true, voice: true, phone: false };

// Only the last postal code and the phone topic are kept across tabs; earlier versions kept more.
chrome.storage.local.remove(['running', 'tabId', 'fails', 'failingSince', 'lastReloadAt', 'alerted', 'nextAt', 'lastGap',
  'target', 'manualPart', 'lang', 'channels', 'panelPos', 'collapsed']);

// Language and alert choices belong to the tab (sent by its panel); the phone topic is shared.
async function getPrefs(w) {
  const { ntfyTopic } = await chrome.storage.local.get('ntfyTopic');
  return { zh: !!w && w.lang === 'zh', channels: { ...DEFAULT_CHANNELS, ...(w && w.channels) }, topic: ntfyTopic };
}

// ---------- per-tab watches ----------
// chrome.storage.session survives this service worker being shut down, and is cleared when
// Chrome quits, which is also when tab ids stop meaning anything.

const timers = new Map();
let lock = Promise.resolve();
const serial = (fn) => (lock = lock.then(fn, fn));

const getWatches = async () => (await chrome.storage.session.get('watches')).watches || {};
const getWatch = async (tabId) => (await getWatches())[tabId] || null;

function updateWatch(tabId, patch) {
  return serial(async () => {
    const all = await getWatches();
    if (patch) all[tabId] = { ...all[tabId], ...patch };
    else delete all[tabId];
    await chrome.storage.session.set({ watches: all });
    return all[tabId] || null;
  });
}

function schedule(tabId, ms) {
  clearTimeout(timers.get(tabId));
  timers.set(tabId, setTimeout(() => tick(tabId), ms));
}

function unschedule(tabId) {
  clearTimeout(timers.get(tabId));
  timers.delete(tabId);
}

// The Mac stays awake while any tab is watching; the screen may still sleep.
async function syncKeepAwake() {
  const running = Object.values(await getWatches()).some((w) => w.running);
  if (running) chrome.power.requestKeepAwake('system');
  else chrome.power.releaseKeepAwake();
}

function nextDelay(fails) {
  const base = fails ? Math.min(BASE_MS * 2 ** fails, MAX_BACKOFF_MS) : BASE_MS;
  return base + Math.round((Math.random() * 2 - 1) * JITTER_MS);
}

function badge(tabId, text, color) {
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
}

function sendStatus(tabId, w) {
  const msg = { type: 'status', running: !!(w && w.running), nextAt: w && w.running ? w.nextAt : null, lastGap: (w && w.lastGap) || null };
  chrome.tabs.sendMessage(tabId, msg).catch(() => {});
  return msg;
}

// ---------- alert channels ----------

function notifyChrome(title, message, tabId) {
  chrome.notifications.create(`alert-${tabId ?? 'x'}-${Date.now()}`, {
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

async function alertFound(tabId, w, stores, model) {
  const { zh, channels, topic } = await getPrefs(w);
  const title = zh ? `🚨 ${model} 有货了！快去下单` : `🚨 ${model} is in stock! Go buy it`;
  const message = stores.map((x) => `${x.name} ${x.distance} — ${x.quote}`).join('\n');
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const url = tab ? tab.url : '';

  chrome.tabs.sendMessage(tabId, { type: 'found' }).catch(() => {}); // the panel flashes either way
  if (channels.chrome) {
    notifyChrome(title, message, tabId);
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

// Problem warnings (checks failing, a sleep gap, a closed tab) can be turned off per tab, never speak,
// and come at most once an hour, so a night of Apple rate limits doesn't keep anyone up.
const warnsOn = (w) => !w || w.warn !== false;

// Sent once when a tab's checks have been failing for a while, so a quiet panel isn't mistaken for "no stock".
async function warnFailing(tabId, w, model) {
  if (!warnsOn(w)) return;
  const { zh, channels, topic } = await getPrefs(w);
  const text = zh
    ? `${model || 'iPhone'} 的库存检查已经五分钟没成功了，可能被 Apple 暂时限制，扩展会自动重试。`
    : `Stock checks for ${model || 'your iPhone'} haven't worked for 5 minutes. Apple may be blocking them; the extension keeps retrying.`;
  if (channels.chrome) notifyChrome(NAME, text, tabId);
  if (channels.phone && topic) pushPhone(topic, NAME, text, '');
}

// Checks can't run while the Mac sleeps, so say how long they were paused once they're back.
async function reportGap(w, minutes) {
  if (!warnsOn(w)) return;
  const model = w.model;
  const { zh, channels, topic } = await getPrefs(w);
  const text = zh
    ? `${model || 'iPhone'} 的监控暂停了 ${minutes} 分钟（Mac 睡眠或 Chrome 被暂停），现在已恢复。`
    : `Watching ${model || 'your iPhone'} was paused for ${minutes} min (Mac asleep or Chrome paused). It's running again.`;
  if (channels.phone && topic) pushPhone(topic, NAME, text, '');
}

async function reportTabClosed(w) {
  if (!warnsOn(w)) return;
  const model = w.model;
  const { zh, channels, topic } = await getPrefs(w);
  const text = zh
    ? `已停止监控 ${model || 'iPhone'}：Apple 页面被关掉了。`
    : `Stopped watching ${model || 'your iPhone'}: its Apple page was closed.`;
  if (channels.chrome) notifyChrome(NAME, text);
  if (channels.phone && topic) pushPhone(topic, NAME, text, '');
}

async function testChannel(channel, lang) {
  const { zh, topic } = await getPrefs({ lang });
  const title = zh ? 'iPhone 取货提醒测试' : `${NAME} test`;
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

function askTab(tabId) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, { type: 'check' }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Page not responding')), TAB_TIMEOUT_MS)),
  ]);
}

async function tick(tabId) {
  timers.delete(tabId);
  const w = await getWatch(tabId);
  if (!w || !w.running) return;
  if (!(await chrome.tabs.get(tabId).catch(() => null))) return forget(tabId);
  const now = Date.now();
  let lastGap = w.lastGap || null;
  let lastWarnAt = w.lastWarnAt || 0;
  const mayWarn = () => now - lastWarnAt > WARN_EVERY_MS && (lastWarnAt = now);
  if (w.nextAt && now - w.nextAt > GAP_MS) {
    lastGap = { minutes: Math.round((now - w.nextAt) / 60_000), at: now };
    if (mayWarn()) reportGap(w, lastGap.minutes);
  }

  let r;
  try {
    r = await askTab(tabId);
  } catch (e) {
    r = { ok: false, dead: true };
  }
  let fails = w.fails || 0;
  let failingSince = w.failingSince || null;
  let alerted = w.alerted || [];
  let lastReloadAt = w.lastReloadAt || 0;
  const model = (r && r.model) || w.model;
  const reload = () => {
    lastReloadAt = Date.now();
    chrome.tabs.reload(tabId).catch(() => {});
  };

  if (r && r.ok) {
    fails = 0;
    failingSince = null;
    const found = r.stores.filter((x) => x.available);
    const fresh = found.filter((x) => !alerted.includes(x.id));
    alerted = found.map((x) => x.id);
    badge(tabId, found.length ? '!!!' : 'OK', found.length ? '#d00' : '#2a2');
    if (fresh.length) await alertFound(tabId, w, fresh, r.model);
    else if (now - lastReloadAt > HEALTHY_RELOAD_MS && !found.length) reload();
  } else {
    fails += 1;
    badge(tabId, 'ERR', '#c60');
    if (!failingSince) failingSince = now;
    else if (failingSince > 0 && now - failingSince > FAILING_WARN_MS) {
      if (mayWarn()) await warnFailing(tabId, w, model);
      failingSince = -1; // stays quiet until a check works again
    }
    const sinceReload = now - lastReloadAt;
    // A dead tab gets a minute to finish loading before we reload it again.
    if ((r && r.dead && sinceReload > 60_000) || (fails >= RELOAD_AFTER_FAILS && sinceReload > MIN_RELOAD_GAP_MS)) reload();
  }

  const delay = nextDelay(fails);
  const updated = await updateWatch(tabId, { fails, failingSince, alerted, lastReloadAt, lastGap, lastWarnAt, model, nextAt: Date.now() + delay });
  if (!updated || !updated.running) return; // stopped while this check was running
  schedule(tabId, delay);
  sendStatus(tabId, updated);
}

async function forget(tabId) {
  unschedule(tabId);
  await updateWatch(tabId, null);
  syncKeepAwake();
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab && sender.tab.id;
  if (msg.type === 'hello' && tabId != null) {
    // A reloaded tab keeps watching; one that moved to another iPhone's page stops.
    getWatch(tabId).then(async (w) => {
      if (w && w.running && w.family !== msg.family) w = await updateWatch(tabId, { running: false, nextAt: null });
      if (w && w.running && !timers.has(tabId)) schedule(tabId, 1_000);
      if (!w || !w.running) badge(tabId, '', '#888');
      syncKeepAwake();
      reply(sendStatus(tabId, w));
    });
    return true;
  }
  if (msg.type === 'start' && tabId != null) {
    updateWatch(tabId, {
      running: true, family: msg.family, lang: msg.lang, channels: msg.channels, warn: msg.warn, model: null, fails: 0,
      failingSince: null, alerted: [], lastReloadAt: Date.now(), nextAt: null, lastGap: null,
    }).then((w) => {
      chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});
      syncKeepAwake();
      schedule(tabId, 0);
      sendStatus(tabId, w);
    });
  } else if (msg.type === 'stop' && tabId != null) {
    unschedule(tabId);
    stopVoice();
    badge(tabId, '', '#888');
    updateWatch(tabId, { running: false, nextAt: null }).then((w) => {
      syncKeepAwake();
      sendStatus(tabId, w);
    });
  } else if (msg.type === 'reset' && tabId != null) {
    updateWatch(tabId, { alerted: [], fails: 0, model: null }).then((w) => w && w.running && schedule(tabId, 1_000));
  } else if (msg.type === 'prefs' && tabId != null) {
    updateWatch(tabId, { lang: msg.lang, channels: msg.channels, warn: msg.warn });
  } else if (msg.type === 'dismissGap' && tabId != null) {
    updateWatch(tabId, { lastGap: null });
  } else if (msg.type === 'ack') {
    stopVoice();
  } else if (msg.type === 'test') {
    testChannel(msg.channel, msg.lang).then(reply);
    return true; // async reply
  }
});

// Clicking an alert brings its tab back and silences the alarm.
chrome.notifications.onClicked.addListener(async (id) => {
  stopVoice();
  const tabId = Number(id.split('-')[1]);
  const tab = Number.isInteger(tabId) ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (!tab) return;
  chrome.windows.update(tab.windowId, { focused: true });
  chrome.tabs.update(tabId, { active: true });
  chrome.tabs.sendMessage(tabId, { type: 'ack' }).catch(() => {});
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const w = await getWatch(tabId);
  if (!w) return;
  await forget(tabId);
  if (w.running) reportTabClosed(w);
});

// Chrome can shut down this service worker; the alarm wakes it up and restarts every loop.
chrome.alarms.create('watchdog', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async () => {
  for (const [id, w] of Object.entries(await getWatches())) {
    if (w.running && !timers.has(Number(id))) schedule(Number(id), 0);
  }
});
