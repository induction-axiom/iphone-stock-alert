// Drives the polling loop and sends alerts. Timers live here rather than in the page because
// Chrome throttles timers in background tabs to once a minute; messages to the tab are not throttled.
const HELPER = 'http://127.0.0.1:8765';
const NTFY = 'https://ntfy.sh/';
const BASE_MS = 10_000;
const JITTER_MS = 2_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const RELOAD_AFTER_FAILS = 3;
const MIN_RELOAD_GAP_MS = 5 * 60_000;
const HEALTHY_RELOAD_MS = 30 * 60_000; // refresh Apple's cookies now and then
const TAB_TIMEOUT_MS = 20_000;
const DEFAULT_CHANNELS = { chrome: true, mac: false, phone: false };

let timer = null;

const getState = () =>
  chrome.storage.local.get(['running', 'tabId', 'fails', 'lastReloadAt', 'alerted']);

async function getPrefs() {
  const p = await chrome.storage.local.get(['lang', 'channels', 'ntfyTopic']);
  return { zh: p.lang === 'zh', channels: { ...DEFAULT_CHANNELS, ...p.channels }, topic: p.ntfyTopic };
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

// Every helper call carries the panel's language, so its voice and dialogs match.
async function helper(path, body) {
  const { zh } = await getPrefs();
  return fetch(HELPER + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Stock-Alert': '1' },
    body: JSON.stringify({ ...body, lang: zh ? 'zh' : 'en' }),
  })
    .then((r) => r.ok)
    .catch(() => false);
}

const helperAlive = () => fetch(HELPER + '/status').then((r) => r.ok).catch(() => false);

// Only pings the helper when the Mac alarm is on, so its watchdog stays quiet otherwise.
async function pingHelper(body) {
  const { channels } = await getPrefs();
  return channels.mac ? helper('/ping', body) : null;
}

function notifyChrome(title, message) {
  chrome.notifications.create('alert-' + Date.now(), {
    type: 'basic',
    iconUrl: 'icon.png',
    title,
    message,
    priority: 2,
    requireInteraction: true,
  });
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

  chrome.tabs.sendMessage(tabId, { type: 'found' }).catch(() => {}); // panel flashes either way
  if (channels.chrome) {
    notifyChrome(title, message);
    if (tab) {
      await chrome.windows.update(tab.windowId, { focused: true, drawAttention: true, state: 'normal' }).catch(() => {});
      await chrome.tabs.update(tabId, { active: true }).catch(() => {});
    }
  }
  if (channels.mac) helper('/alert', { title, model, message, url });
  if (channels.phone && topic) pushPhone(topic, title, message, url);
}

async function testChannel(channel) {
  const { zh, topic } = await getPrefs();
  const title = zh ? 'iPhone 到货提醒测试' : 'iPhone Stock Alert test';
  const message = zh ? '这是一条测试提醒，到货时会是这样。' : 'This is a test. A real alert looks like this.';
  if (channel === 'chrome') {
    notifyChrome(title, message);
    return new Promise((done) => chrome.notifications.getPermissionLevel((level) => done(level === 'granted')));
  }
  if (channel === 'mac') return helper('/alert', { title, model: 'iPhone', message, url: '' });
  if (channel === 'phone') return topic ? pushPhone(topic, title, message, '') : false;
  return false;
}

// ---------- polling ----------

// Tells the panel when the next check is and whether the Mac helper answered.
function pushStatus(tabId, running, nextAt, helperOk) {
  if (tabId == null) return;
  chrome.tabs.sendMessage(tabId, { type: 'status', running, nextAt, helperOk }).catch(() => {});
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
  if (s.tabId == null) {
    badge('?', '#888');
    return; // waits for a 'hello' from an open iPhone buy page
  }

  let r;
  try {
    r = await askTab(s.tabId);
  } catch (e) {
    r = { ok: false, error: e.message, dead: true };
  }
  const now = Date.now();
  let fails = s.fails || 0;
  let helperOk;

  if (r && r.ok) {
    fails = 0;
    const found = r.stores.filter((x) => x.available);
    const fresh = found.filter((x) => !(s.alerted || []).includes(x.id));
    await chrome.storage.local.set({ alerted: found.map((x) => x.id) });
    helperOk = await pingHelper({ ok: true, summary: `${found.length}/${r.stores.length} stores available` });
    badge(found.length ? '!!!' : 'OK', found.length ? '#d00' : '#2a2');
    if (fresh.length) await alertFound(fresh, s.tabId, r.model);
    else if (now - (s.lastReloadAt || 0) > HEALTHY_RELOAD_MS && !found.length) await reloadTab(s.tabId);
  } else {
    fails += 1;
    helperOk = await pingHelper({ ok: false, error: (r && r.error) || 'Unknown error' });
    badge('ERR', '#c60');
    const sinceReload = now - (s.lastReloadAt || 0);
    // A dead tab gets a minute to finish loading before we reload it again.
    if ((r && r.dead && sinceReload > 60_000) || (fails >= RELOAD_AFTER_FAILS && sinceReload > MIN_RELOAD_GAP_MS)) {
      await reloadTab(s.tabId);
    }
  }

  await chrome.storage.local.set({ fails });
  const delay = nextDelay(fails);
  schedule(delay);
  pushStatus(s.tabId, true, Date.now() + delay, helperOk);
}

function badge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'hello' && sender.tab) {
    chrome.tabs.update(sender.tab.id, { autoDiscardable: false });
    chrome.storage.local.set({ tabId: sender.tab.id }).then(async () => {
      const s = await getState();
      if (s.running && !timer) schedule(1_000);
      pushStatus(sender.tab.id, !!s.running, null, await helperAlive());
    });
  } else if (msg.type === 'start') {
    chrome.storage.local.set({ running: true, fails: 0, alerted: [], lastReloadAt: Date.now() }).then(() => schedule(0));
  } else if (msg.type === 'stop') {
    clearTimeout(timer);
    timer = null;
    chrome.storage.local.set({ running: false });
    badge('', '#888');
    pingHelper({ stopped: true });
    if (sender.tab) pushStatus(sender.tab.id, false, null, null);
  } else if (msg.type === 'reset') {
    chrome.storage.local.set({ alerted: [], fails: 0 }).then(() => timer && schedule(1_000));
  } else if (msg.type === 'ack') {
    helper('/ack');
  } else if (msg.type === 'helper?') {
    helperAlive().then(reply);
    return true; // async reply
  } else if (msg.type === 'test') {
    testChannel(msg.channel).then(reply);
    return true;
  }
});

chrome.notifications.onClicked.addListener(async () => {
  const { tabId } = await getState();
  if (tabId == null) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) {
    chrome.windows.update(tab.windowId, { focused: true });
    chrome.tabs.update(tabId, { active: true });
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const s = await getState();
  if (tabId === s.tabId) await chrome.storage.local.set({ tabId: null });
});

// Chrome can shut down this service worker; the alarm wakes it up and restarts the loop.
// It also tells the helper we're alive, since checks are minutes apart while backing off.
chrome.alarms.create('watchdog', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async () => {
  const s = await getState();
  if (!s.running) return;
  pingHelper({ alive: true });
  if (!timer) schedule(0);
});
