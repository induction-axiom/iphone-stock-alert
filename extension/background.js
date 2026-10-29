// Drives the polling loop. Timers live here rather than in the page because Chrome throttles
// timers in background tabs to once a minute; messages to the tab are not throttled.
const HELPER = 'http://127.0.0.1:8765';
const BASE_MS = 10_000;
const JITTER_MS = 2_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const RELOAD_AFTER_FAILS = 3;
const MIN_RELOAD_GAP_MS = 5 * 60_000;
const HEALTHY_RELOAD_MS = 30 * 60_000; // refresh Apple's cookies now and then
const TAB_TIMEOUT_MS = 20_000;

let timer = null;

const getState = () =>
  chrome.storage.local.get(['running', 'tabId', 'fails', 'lastReloadAt', 'alerted']);

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(tick, ms);
}

function nextDelay(fails) {
  const base = fails ? Math.min(BASE_MS * 2 ** fails, MAX_BACKOFF_MS) : BASE_MS;
  return base + Math.round((Math.random() * 2 - 1) * JITTER_MS);
}

async function getLang() {
  const { lang } = await chrome.storage.local.get('lang');
  return lang === 'zh' ? 'zh' : 'en';
}

// Every helper call carries the panel's language, so its voice and dialogs match.
async function helper(path, body) {
  return fetch(HELPER + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Duo-Watch': '1' },
    body: JSON.stringify({ ...body, lang: await getLang() }),
  })
    .then((r) => r.ok)
    .catch(() => false); // helper is optional
}

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
    return; // waits for a 'hello' from an open iPhone Duo page
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
    helperOk = await helper('/ping', { ok: true, summary: `${found.length}/${r.stores.length} stores available` });
    badge(found.length ? '!!!' : 'OK', found.length ? '#d00' : '#2a2');
    if (fresh.length) await alertFound(fresh, s.tabId);
    else if (now - (s.lastReloadAt || 0) > HEALTHY_RELOAD_MS && !found.length) await reloadTab(s.tabId);
  } else {
    fails += 1;
    const error = (r && r.error) || 'Unknown error';
    helperOk = await helper('/ping', { ok: false, error });
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

async function alertFound(stores, tabId) {
  const zh = (await getLang()) === 'zh';
  const message = stores.map((x) => `${x.name} ${x.distance} — ${x.quote}`).join('\n');
  let url = '';
  try {
    const tab = await chrome.tabs.get(tabId);
    url = tab.url;
    await chrome.windows.update(tab.windowId, { focused: true, drawAttention: true, state: 'normal' });
    await chrome.tabs.update(tabId, { active: true });
  } catch (e) {}
  chrome.notifications.create('found-' + Date.now(), {
    type: 'basic',
    iconUrl: 'icon.png',
    title: zh ? '🚨 iPhone Duo 有货了！快去下单' : '🚨 iPhone Duo is in stock! Go buy it',
    message,
    priority: 2,
    requireInteraction: true,
  });
  chrome.tabs.sendMessage(tabId, { type: 'found' }).catch(() => {});
  helper('/alert', { title: zh ? 'iPhone Duo 有货了' : 'iPhone Duo in stock', message, url });
}

function badge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'hello' && sender.tab) {
    chrome.tabs.update(sender.tab.id, { autoDiscardable: false });
    chrome.storage.local.set({ tabId: sender.tab.id }).then(async () => {
      const s = await getState();
      if (s.running && !timer) schedule(1_000);
      const helperOk = await fetch(HELPER + '/status').then((r) => r.ok).catch(() => false);
      pushStatus(sender.tab.id, !!s.running, null, helperOk);
    });
  } else if (msg.type === 'start') {
    chrome.storage.local.set({ running: true, fails: 0, alerted: [], lastReloadAt: Date.now() }).then(() => schedule(0));
  } else if (msg.type === 'stop') {
    clearTimeout(timer);
    timer = null;
    chrome.storage.local.set({ running: false });
    badge('', '#888');
    helper('/ping', { stopped: true }).then((ok) => sender.tab && pushStatus(sender.tab.id, false, null, ok));
  } else if (msg.type === 'ack') {
    helper('/ack');
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
  helper('/ping', { alive: true });
  if (!timer) schedule(0);
});
