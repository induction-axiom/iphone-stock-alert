// Runs on Apple's iPhone buy pages. Does the actual availability request (same origin, your own
// cookies) when background.js asks, and shows a draggable control panel.
const { regionPrefix, familySlug, familyName, listModels, availabilityUrl, parseAvailability } = StockParse;

const prefix = regionPrefix(location.pathname);
const family = familySlug(location.pathname);
const familyLabel = family ? familyName(family) : 'iPhone';
let models = [];
const DEFAULT_CHANNELS = { chrome: true, voice: true, phone: false };
let lang = 'en';
// lastOk is the latest successful result; result is the latest check, which may have failed.
const view = { running: false, ringing: false, result: null, lastOk: null, okAt: null, nextAt: null, editing: false, testNote: null, lastGap: null };

const STRINGS = {
  en: {
    noPostal: 'Enter your postal code first',
    noModel: 'Pick a model first',
    network: (m) => 'Network error: ' + m,
    http: (s) => `HTTP ${s}` + (s === 541 ? ': temporarily blocked by Apple' : ''),
    notJson: 'Response was not JSON (probably blocked)',
    clearCookies: 'Clear Apple cookies and retry',
    clearCookiesHint: 'If Apple keeps blocking this browser, a fresh start often helps. Signs you out of apple.com.',
    badShape: 'Unrecognized response format',
    apple: (m) => 'Apple says: ' + m,
    flashA: '🚨 IN STOCK!',
    flashB: '📱 iPhone in stock',
    found: (n) => `In stock at ${n} store${n > 1 ? 's' : ''}!`,
    paused: 'Paused',
    starting: 'Starting…',
    failing: "Can't check right now",
    none: 'Not in stock yet',
    ago: (s) => (s < 5 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.floor(s / 60)} min ago`),
    checked: (a) => `Checked ${a}`,
    lastGood: (a) => `Last good check ${a}`,
    noGood: 'No successful check yet',
    never: 'Not checked yet',
    next: (n) => ` · next in ${n}s`,
    retry: (n) => ` · retrying in ${n}s`,
    watching: 'Watching',
    alerts: 'Alerts',
    problems: 'Problems',
    problemsOn: 'Alert me once if checking stops working',
    problemsOff: 'Stay quiet if checking stops working',
    on: 'On',
    off: 'Off',
    edit: 'Edit',
    done: 'Done',
    notSet: 'Pick a model and postal code',
    short: { chrome: 'Chrome', voice: 'Voice', phone: 'Phone' },
    hint: {
      chrome: 'Chrome notification: pops up and brings this tab to the front',
      voice: "Say it out loud: repeats until you stop it. Keep your Mac's volume up.",
      phone: 'Phone push: free ntfy app, max priority',
    },
    test: 'Test',
    testResult: (list) => `Test sent: ${list}.`,
    chromeHelp: 'No notification? Allow Google Chrome in macOS System Settings → Notifications, and turn off Focus.',
    phoneHow: 'Install the free ntfy app, tap +, and subscribe to this topic:',
    badTopic: 'Use 1–64 letters, numbers, - or _',
    newTopic: 'New',
    fine: 'Checks only while this tab is open and your Mac is awake. Closing the lid or quitting Chrome pauses it.',
    gap: (m, at) => `Paused ${m} min (Mac asleep or Chrome paused) · resumed ${at}`,
    dismiss: 'Dismiss',
    copy: 'Copy',
    copied: 'Copied',
    yes: 'Available',
    no: 'None',
    delivery: (d) => `Ship to home: ${d}`,
    postal: 'Postal / ZIP code',
    model: 'Model',
    choose: 'Choose…',
    start: 'Start watching',
    stop: 'Stop',
    ack: 'Silence alarm',
    collapse: 'Collapse / expand',
  },
  zh: {
    noPostal: '请先填邮编',
    noModel: '请先选机型',
    network: (m) => '网络错误：' + m,
    http: (s) => `HTTP ${s}` + (s === 541 ? '，被 Apple 暂时限制' : ''),
    notJson: '返回的不是 JSON（可能被限制）',
    clearCookies: '清除 Apple cookie 并重试',
    clearCookiesHint: '如果 Apple 一直限制这个浏览器，清除后重来通常有用。apple.com 会被登出。',
    badShape: '响应格式不认识',
    apple: (m) => 'Apple 返回：' + m,
    flashA: '🚨 有货！有货！',
    flashB: '📱 iPhone 有货',
    found: (n) => `有货！${n} 家店可取`,
    paused: '已暂停',
    starting: '正在开始…',
    failing: '暂时查不到',
    none: '暂时没货',
    ago: (s) => (s < 5 ? '刚刚' : s < 60 ? `${s} 秒前` : `${Math.floor(s / 60)} 分钟前`),
    checked: (a) => `${a}检查`,
    lastGood: (a) => `上次成功：${a}`,
    noGood: '还没有成功查过',
    never: '还没查过',
    next: (n) => ` · ${n} 秒后再查`,
    retry: (n) => ` · ${n} 秒后重试`,
    watching: '监控',
    alerts: '提醒',
    problems: '异常',
    problemsOn: '查询出问题时提醒一次',
    problemsOff: '查询出问题时不提醒',
    on: '开',
    off: '关',
    edit: '修改',
    done: '完成',
    notSet: '请选机型、填邮编',
    short: { chrome: 'Chrome', voice: '语音', phone: '手机' },
    hint: {
      chrome: 'Chrome 通知：弹出通知，并把这个页面切到最前面',
      voice: '语音播报：一直重复，直到你点停止。请把 Mac 音量调大。',
      phone: '推送到手机：免费的 ntfy App，最高优先级',
    },
    test: '测试',
    testResult: (list) => `已发送测试：${list}。`,
    chromeHelp: '没看到通知？在 macOS 系统设置 → 通知 → Google Chrome 里允许通知，并关掉专注模式。',
    phoneHow: '安装免费的 ntfy App，点 +，订阅这个主题：',
    badTopic: '只能用 1–64 个字母、数字、- 或 _',
    newTopic: '换一个',
    fine: '只在这个页面开着、Mac 醒着时检查。合上盖子或退出 Chrome 会暂停。',
    gap: (m, at) => `暂停了 ${m} 分钟（Mac 睡眠或 Chrome 被暂停）· ${at} 已恢复`,
    dismiss: '关闭',
    copy: '复制',
    copied: '已复制',
    yes: '可取货',
    no: '无货',
    delivery: (d) => `网上订购送货：${d}`,
    postal: '邮编',
    model: '机型',
    choose: '请选择…',
    start: '开始监控',
    stop: '停止监控',
    ack: '停止报警',
    collapse: '折叠/展开',
  },
};
const t = (key, ...args) => {
  const s = STRINGS[lang][key];
  return typeof s === 'function' ? s(...args) : s;
};

// Each tab is its own watch. Its settings, and whether it's watching, live in the page's
// sessionStorage, so they survive this tab reloading (to refresh Apple's cookies, or after the
// extension updates) and vanish when it closes. Only the last postal code and the phone topic are
// remembered across tabs.
const tabGet = (name) => sessionStorage.getItem('pickupAlert.' + name) || '';
const tabSet = (name, value) =>
  value ? sessionStorage.setItem('pickupAlert.' + name, value) : sessionStorage.removeItem('pickupAlert.' + name);
const tabJson = (name) => JSON.parse(tabGet(name) || 'null');

async function getConfig() {
  const c = await chrome.storage.local.get(['postal', 'ntfyTopic']);
  c.target = tabGet('model.' + family); // per product, so moving this tab to another iPhone starts clean
  c.lang = tabGet('lang') === 'zh' ? 'zh' : 'en';
  c.collapsed = tabGet('collapsed') === '1';
  c.panelPos = tabJson('pos');
  c.channels = { ...DEFAULT_CHANNELS, ...tabJson('channels') };
  c.warn = tabGet('warn') !== 'off';
  return c;
}

// The background needs this tab's alert choices and language to send its alerts.
async function sendPrefs() {
  const c = await getConfig();
  chrome.runtime.sendMessage({ type: 'prefs', lang: c.lang, channels: c.channels, warn: c.warn }).catch(() => {});
}

const modelKey = (m) => [m.screen, m.capacity, m.color].join('|');

// The color name as the page's own color picker shows it ("Star White").
function colorLabel(m) {
  const input = document.querySelector(`input[value="${CSS.escape(m.color)}"]`);
  const label = input && (input.closest('label') || (input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`)));
  return (label && label.textContent.trim().replace(/\s+/g, ' ')) || m.color;
}

function modelLabel(m) {
  const screen = m.screen ? m.screen.replace('_', '.').replace('inch', '"') + ' · ' : '';
  return `${screen}${m.capacity.toUpperCase()} · ${colorLabel(m)}`;
}

// The model is stored as dimension values, not a part number, because part numbers differ per
// country (LL/A in the US, VC/A in Canada...).
function currentModel(c) {
  return models.find((m) => modelKey(m) === c.target) || null;
}

// First visit to a product: preselect the model in the URL, e.g. .../256gb-star-white-unlocked.
async function pickFromUrl() {
  const c = await getConfig();
  if (currentModel(c)) return;
  const path = location.pathname.replace(/[^a-z0-9]/g, '');
  const m = models.find((x) => path.includes(x.capacity + x.color) && (!x.screen || path.includes(x.screen.replace(/[^a-z0-9]/g, ''))));
  if (m) tabSet('model.' + family, modelKey(m));
}

// Results keep an error key plus arguments, so switching language re-renders them correctly.
async function check() {
  const c = await getConfig();
  if (!c.postal) return { ok: false, err: ['noPostal'] };
  const model = currentModel(c);
  if (!model) return { ok: false, err: ['noModel'] };
  const part = model.part;
  const name = `${familyLabel} ${modelLabel(model)}`;

  let res;
  try {
    res = await fetch(availabilityUrl(prefix, part, c.postal), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
  } catch (e) {
    return { ok: false, err: ['network', e.message] };
  }
  const text = await res.text();
  if (res.status !== 200) return { ok: false, status: res.status, err: ['http', res.status] };
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, status: res.status, err: ['notJson'] };
  }
  try {
    return { ok: true, part, model: name, ...parseAvailability(data, part) };
  } catch (e) {
    console.warn('[Pickup Alert for iPhone] raw response', data);
    return { ok: false, err: e.code === 'apple' ? ['apple', e.message] : ['badShape'] };
  }
}

// ---------- tab title flashing while an alarm rings ----------

const pageTitle = document.title;
let flashTimer = null;

function startFlash() {
  view.ringing = true;
  if (!flashTimer) {
    let n = 0;
    flashTimer = setInterval(() => (document.title = n++ % 2 ? t('flashA') : t('flashB')), 500);
  }
  render();
}

function stopFlash() {
  view.ringing = false;
  clearInterval(flashTimer);
  flashTimer = null;
  document.title = pageTitle;
  render();
}

// ---------- panel ----------

const host = document.createElement('div');
host.style.cssText = 'position:fixed;z-index:2147483647;right:20px;bottom:20px;';
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `
<style>
  :host { all: initial; }
  .card {
    --bg: rgba(255,255,255,.88); --fg: #1d1d1f; --muted: #6e6e73; --line: rgba(0,0,0,.08);
    --chip: rgba(0,0,0,.05); --green: #1f9d55; --red: #e5243b; --amber: #c27803; --blue: #0071e3;
    width: 340px; color: var(--fg); background: var(--bg);
    backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px);
    border: 1px solid var(--line); border-radius: 18px;
    box-shadow: 0 12px 40px rgba(0,0,0,.18), 0 2px 6px rgba(0,0,0,.06);
    font: 13px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", system-ui, sans-serif;
    overflow: hidden; transition: box-shadow .2s, border-color .2s;
    display: flex; flex-direction: column; max-height: calc(100vh - 40px);
  }
  @media (prefers-color-scheme: dark) {
    .card { --bg: rgba(28,28,30,.88); --fg: #f5f5f7; --muted: #a1a1a6; --line: rgba(255,255,255,.1);
            --chip: rgba(255,255,255,.08); --green: #30d158; --red: #ff453a; --amber: #ffb340; --blue: #0a84ff; }
  }
  .bar { flex: none; display: flex; align-items: center; gap: 8px; padding: 10px 12px 10px 14px; cursor: grab; user-select: none; }
  .bar:active { cursor: grabbing; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); flex: none; }
  .title { font-weight: 600; letter-spacing: -.01em; }
  .mini { display: none; color: var(--muted); font-size: 12px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .collapsed .mini { display: block; }
  .grow { flex: 1; }
  .icon { all: unset; width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center;
          color: var(--muted); cursor: pointer; font-size: 15px; }
  .icon:hover { background: var(--chip); color: var(--fg); }
  .lang { display: flex; padding: 2px; border-radius: 7px; background: var(--chip); }
  .lang button { all: unset; padding: 1px 7px; border-radius: 5px; font-size: 11px; font-weight: 600; color: var(--muted); cursor: pointer; }
  .lang button.on { background: var(--bg); color: var(--fg); box-shadow: 0 1px 2px rgba(0,0,0,.15); }
  .lang button:not(.on):hover { color: var(--blue); }
  .body { padding: 0 14px 14px; overflow-y: auto; min-height: 0; overscroll-behavior: contain; }
  .collapsed .body { display: none; }
  .headline { font-size: 22px; font-weight: 700; letter-spacing: -.02em; margin: 2px 0 0; }
  .meta { color: var(--muted); font-size: 12px; }

  .status { margin: 10px 0; padding: 2px 10px; border-radius: 12px; background: var(--chip); }
  .srow { display: flex; align-items: center; gap: 8px; min-height: 30px; font-size: 12px; }
  .srow + .srow, .fields + .srow, .howto + .srow { border-top: 1px solid var(--line); }
  .srow .k { width: 50px; flex: none; color: var(--muted); align-self: flex-start; padding-top: 7px; }
  .srow .v { flex: 1; min-width: 0; padding: 6px 0; line-height: 1.4; }
  .srow .v.unset { color: var(--amber); }
  .srow .v.hintv { color: var(--muted); font-size: 11px; }
  button.link { all: unset; color: var(--blue); font-weight: 600; font-size: 12px; cursor: pointer; padding: 2px 4px; margin-right: -4px; border-radius: 6px; align-self: flex-start; margin-top: 5px; }
  .code button.link { align-self: center; margin-top: 0; }
  button.link:hover { background: color-mix(in srgb, var(--blue) 10%, transparent); }
  .toggles { display: flex; flex-wrap: wrap; gap: 4px; }
  button.tog { all: unset; padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 600; cursor: pointer;
               color: var(--muted); border: 1px solid color-mix(in srgb, var(--fg) 20%, transparent); }
  button.tog:hover { border-color: var(--blue); color: var(--blue); }
  button.tog[aria-pressed="true"] { color: #fff; border-color: var(--blue); background: var(--blue); }
  button.tog[aria-pressed="true"]:hover { color: #fff; filter: brightness(1.08); }

  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 2px 0 10px; }
  .wide { grid-column: 1 / -1; }
  label { display: grid; gap: 3px; color: var(--muted); font-size: 11px; }
  input, select { all: unset; box-sizing: border-box; width: 100%; padding: 6px 8px; border-radius: 8px; background: var(--bg);
                  color: var(--fg); font-size: 13px; border: 1px solid var(--line); }
  input:hover, select:hover { border-color: color-mix(in srgb, var(--fg) 25%, transparent); }
  select { cursor: pointer; background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%), linear-gradient(135deg, var(--muted) 50%, transparent 50%);
           background-position: calc(100% - 13px) 50%, calc(100% - 9px) 50%; background-size: 4px 4px; background-repeat: no-repeat; padding-right: 24px; }
  select option { color: #1d1d1f; }
  input:focus, select:focus { border-color: var(--blue); }
  .howto { padding: 0 0 8px; color: var(--muted); font-size: 11px; }
  .howto a { color: var(--blue); }
  [data-v=badTopic] { margin-top: 4px; color: var(--amber); }
  .code { display: flex; align-items: center; gap: 6px; margin-top: 5px; padding: 5px 5px 5px 8px; border-radius: 8px; background: var(--bg);
          border: 1px solid var(--line); cursor: text; }
  .code:hover { border-color: color-mix(in srgb, var(--fg) 25%, transparent); }
  .code:focus-within { border-color: var(--blue); }
  .code input.topic { all: unset; flex: 1; min-width: 0; font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--fg); }

  .stores { border-top: 1px solid var(--line); max-height: 220px; overflow: auto; transition: opacity .2s; }
  .stores.stale { opacity: .5; }
  .row { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--line); }
  .row .name { flex: 1; min-width: 0; }
  .row .name b { font-weight: 500; }
  .row .name small { display: block; color: var(--muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .dist { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .pill { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--chip); color: var(--muted); white-space: nowrap; }
  .pill.yes { background: var(--green); color: #fff; }
  .note { margin-top: 8px; color: var(--muted); font-size: 12px; }
  .err { margin-top: 8px; padding: 8px 10px; border-radius: 10px; background: color-mix(in srgb, var(--amber) 14%, transparent); color: var(--fg); font-size: 12px; }
  .gap { display: flex; align-items: flex-start; gap: 8px; margin-top: 8px; padding: 7px 8px 7px 10px; border-radius: 10px;
         background: var(--chip); color: var(--fg); font-size: 12px; }
  .gap span { flex: 1; }

  .actions { display: flex; gap: 8px; margin-top: 12px; }
  button.btn { all: unset; flex: 1; text-align: center; padding: 8px 12px; border-radius: 10px; font-weight: 600; cursor: pointer; }
  .btn.primary { background: var(--blue); color: #fff; }
  .btn.secondary { background: var(--chip); color: var(--fg); }
  .btn.danger { background: var(--red); color: #fff; }
  .btn:hover { filter: brightness(1.08); }
  .fine { margin-top: 8px; color: var(--muted); font-size: 11px; text-align: center; }
  button:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
  [hidden] { display: none !important; }

  .card[data-state="ok"] .dot { background: var(--green); box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 25%, transparent); }
  .card[data-state="error"] .dot { background: var(--amber); }
  .card[data-state="found"] { border-color: var(--red); animation: pulse 1s ease-in-out infinite; }
  .card[data-state="found"] .dot { background: var(--red); }
  .card[data-state="found"] .headline { color: var(--red); }
  .card.flash { animation: pulse 1s ease-in-out 3; border-color: var(--red); }
  @keyframes pulse { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--red) 45%, transparent), 0 12px 40px rgba(0,0,0,.18); } }
  .running .dot { animation: breathe 2s ease-in-out infinite; }
  @keyframes breathe { 50% { opacity: .45; } }
</style>
<div class="card" data-state="idle">
  <div class="bar" data-drag>
    <span class="dot"></span><span class="title">Pickup Alert for iPhone</span><span class="mini"></span>
    <span class="grow"></span>
    <div class="lang"><button data-lang="en">EN</button><button data-lang="zh">中</button></div>
    <button class="icon" data-a="collapse">–</button>
  </div>
  <div class="body">
    <div class="headline"></div>
    <div class="meta" data-v="times"></div>
    <div class="status">
      <div class="srow">
        <span class="k" data-t="watching"></span><span class="v" data-v="watchText"></span>
        <button class="link" data-a="edit"></button>
      </div>
      <div class="fields" data-v="fields" hidden>
        <label class="wide"><span data-t="model"></span><select data-k="model"></select></label>
        <label><span data-t="postal"></span><input data-k="postal" placeholder="95014 / M5V 3L9"></label>
      </div>
      <div class="srow">
        <span class="k" data-t="alerts"></span>
        <span class="v toggles">
          <button class="tog" data-ch="chrome"></button><button class="tog" data-ch="voice"></button><button class="tog" data-ch="phone"></button>
        </span>
        <button class="link" data-a="test" data-t="test"></button>
      </div>
      <div class="howto" data-v="testNote" hidden></div>
      <div class="howto" data-v="phoneHow" hidden>
        <span data-t="phoneHow"></span> <a href="https://ntfy.sh" target="_blank" rel="noopener">ntfy.sh</a>
        <div class="code" data-a="focusTopic"><input class="topic" data-k="ntfyTopic" spellcheck="false" aria-label="ntfy topic"><button class="link" data-copy="topic" data-t="copy"></button><button class="link" data-a="newTopic" data-t="newTopic"></button></div>
        <div data-v="badTopic" data-t="badTopic" hidden></div>
      </div>
      <div class="srow">
        <span class="k" data-t="problems"></span><span class="v hintv" data-v="warnText"></span>
        <button class="tog" data-a="warn"></button>
      </div>
    </div>
    <div class="stores"></div>
    <div class="note" data-v="delivery"></div>
    <div class="err" data-v="error" hidden>
      <span data-v="errText"></span>
      <div data-v="blocked" hidden><span class="hintv" data-t="clearCookiesHint"></span> <button class="link" data-a="clearCookies" data-t="clearCookies"></button></div>
    </div>
    <div class="gap" data-v="gap" hidden><span data-v="gapText"></span><button class="icon" data-a="dismissGap">×</button></div>
    <div class="actions">
      <button class="btn primary" data-a="toggle"></button>
      <button class="btn danger" data-a="ack" data-t="ack" hidden></button>
    </div>
    <div class="fine" data-t="fine"></div>
  </div>
</div>`;
document.documentElement.appendChild(host);
// Apple's page has its own document-level handlers; events inside the panel stay inside it.
for (const type of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'keypress', 'input', 'change']) {
  host.addEventListener(type, (e) => e.stopPropagation());
}
const $ = (s) => root.querySelector(s);
const card = $('.card');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clock = (ts) => new Date(ts).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' });
const ago = (ts) => t('ago', Math.max(0, Math.round((Date.now() - ts) / 1000)));

async function render() {
  const c = await getConfig();
  lang = c.lang;
  root.querySelectorAll('[data-t]').forEach((el) => (el.textContent = t(el.dataset.t)));
  root.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
  $('[data-a=collapse]').title = t('collapse');

  // Status: what is being watched and how alerts are set, always visible.
  const model = currentModel(c);
  const ready = !!(model && c.postal);
  $('[data-v=watchText]').textContent = ready ? `${familyLabel} ${modelLabel(model)} · ${c.postal}` : t('notSet');
  $('[data-v=watchText]').classList.toggle('unset', !ready);
  const editing = view.editing || !ready;
  $('[data-v=fields]').hidden = !editing;
  $('[data-a=edit]').textContent = editing ? t('done') : t('edit');
  $('[data-a=edit]').hidden = editing && !ready;
  renderModelOptions(model);

  for (const [k, on] of Object.entries(c.channels)) {
    const b = $(`[data-ch=${k}]`);
    b.textContent = t('short')[k];
    b.title = t('hint')[k];
    b.setAttribute('aria-pressed', String(on));
  }
  $('[data-v=phoneHow]').hidden = !c.channels.phone;
  $('[data-v=warnText]').textContent = c.warn ? t('problemsOn') : t('problemsOff');
  $('[data-a=warn]').textContent = c.warn ? t('on') : t('off');
  $('[data-a=warn]').setAttribute('aria-pressed', String(c.warn));
  const topicInput = $('[data-k=ntfyTopic]');
  if (root.activeElement !== topicInput) topicInput.value = c.ntfyTopic || '';
  $('[data-v=badTopic]').hidden = !view.badTopic;
  $('[data-v=testNote]').hidden = !view.testNote;
  if (view.testNote) {
    const list = view.testNote.map(([k, ok]) => `${t('short')[k]} ${ok ? '✓' : '✗'}`).join(' · ');
    $('[data-v=testNote]').textContent = t('testResult', list) + (view.testNote.some(([k]) => k === 'chrome') ? ' ' + t('chromeHelp') : '');
  }

  // Result: shows the latest good check; a failed check dims it rather than hiding it.
  const r = view.result;
  const failed = r && !r.ok;
  const ok = view.lastOk;
  const found = ok ? ok.stores.filter((s) => s.available) : [];
  card.dataset.state = found.length || view.ringing ? 'found' : !view.running ? 'idle' : failed ? 'error' : ok ? 'ok' : 'idle';
  card.classList.toggle('running', view.running);

  let headline;
  if (found.length) headline = t('found', found.length);
  else if (!view.running && !ok) headline = t('paused');
  else if (failed) headline = t('failing');
  else if (!ok) headline = t('starting');
  else headline = view.running ? t('none') : `${t('none')} · ${t('paused')}`;
  $('.headline').textContent = headline;
  $('.mini').textContent = headline;

  const left = view.running && view.nextAt ? Math.max(0, Math.round((view.nextAt - Date.now()) / 1000)) : null;
  let times;
  if (failed) times = view.okAt ? t('lastGood', ago(view.okAt)) : t('noGood');
  else times = view.okAt ? t('checked', ago(view.okAt)) : t('never');
  if (left != null) times += failed ? t('retry', left) : t('next', left);
  $('[data-v=times]').textContent = times;

  $('[data-v=error]').hidden = !failed;
  if (failed) $('[data-v=errText]').textContent = t(...r.err);
  $('[data-v=blocked]').hidden = !(failed && (r.status === 541 || r.err[0] === 'notJson'));
  $('.stores').innerHTML = ok
    ? ok.stores
        .map(
          (s) => `<div class="row"><div class="name"><b>${esc(s.name)}</b><small>${esc(s.quote || s.display)}</small></div>
            <span class="dist">${esc(s.distance)}</span><span class="pill ${s.available ? 'yes' : ''}">${s.available ? t('yes') : t('no')}</span></div>`
        )
        .join('')
    : '';
  $('.stores').hidden = !(ok && ok.stores.length);
  $('.stores').classList.toggle('stale', !!failed);
  $('[data-v=delivery]').textContent = ok && ok.delivery ? t('delivery', ok.delivery) : '';

  $('[data-v=gap]').hidden = !view.lastGap;
  if (view.lastGap) $('[data-v=gapText]').textContent = t('gap', view.lastGap.minutes, clock(view.lastGap.at));
  $('[data-a=dismissGap]').title = t('dismiss');

  $('[data-a=toggle]').textContent = view.running ? t('stop') : t('start');
  $('[data-a=toggle]').className = 'btn ' + (view.running ? 'secondary' : 'primary');
  $('[data-a=ack]').hidden = !view.ringing;
  card.classList.toggle('collapsed', !!c.collapsed);
  $('[data-a=collapse]').textContent = c.collapsed ? '+' : '–';
}

// Rebuilt only when the language changes, so an open dropdown isn't reset every second.
let optionsLang = null;
function renderModelOptions(selected) {
  const select = $('[data-k=model]');
  if (optionsLang !== lang) {
    optionsLang = lang;
    select.innerHTML =
      `<option value="">${esc(t('choose'))}</option>` +
      models.map((m) => `<option value="${esc(modelKey(m))}">${esc(modelLabel(m))}</option>`).join('');
  }
  select.value = selected ? modelKey(selected) : '';
}

async function initPanel() {
  const c = await getConfig();
  $('[data-k=postal]').value = c.postal || '';
  if (c.panelPos) placeAt(c.panelPos.x, c.panelPos.y);
  render();
  setInterval(() => {
    if (!view.running) return;
    // An extension update or reload cuts this copy of the panel off; reloading the page brings in
    // the new one, which picks the watch back up.
    if (!chrome.runtime?.id) return location.reload();
    render();
  }, 1000);
}

// ntfy topics are public to anyone who knows the name, so a new one is a full random UUID.
const randomTopic = () => 'iphone-alert-' + crypto.randomUUID();

// Editing settings makes the panel taller; nudge a dragged panel back inside the window.
function keepInView() {
  if (host.style.top) {
    const r = host.getBoundingClientRect();
    placeAt(r.left, r.top);
  }
}
new ResizeObserver(keepInView).observe(host);
addEventListener('resize', keepInView);

// Dragging by the title bar; the position is remembered across reloads.
function placeAt(x, y) {
  const w = host.offsetWidth || 340;
  const h = host.offsetHeight || 60;
  x = Math.max(8, Math.min(x, innerWidth - w - 8));
  y = Math.max(8, Math.min(y, innerHeight - h - 8));
  Object.assign(host.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
  return { x, y };
}

$('[data-drag]').addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  const rect = host.getBoundingClientRect();
  const dx = e.clientX - rect.left;
  const dy = e.clientY - rect.top;
  const bar = e.currentTarget;
  bar.setPointerCapture(e.pointerId);
  let pos = null;
  const move = (ev) => (pos = placeAt(ev.clientX - dx, ev.clientY - dy));
  const up = () => {
    bar.removeEventListener('pointermove', move);
    bar.removeEventListener('pointerup', up);
    if (pos) tabSet('pos', JSON.stringify(pos));
  };
  bar.addEventListener('pointermove', move);
  bar.addEventListener('pointerup', up);
});

root.addEventListener('change', async (e) => {
  const k = e.target.dataset && e.target.dataset.k;
  if (!k) return;
  const v = e.target.value.trim();
  if (k === 'model') {
    tabSet('model.' + family, v);
    chrome.runtime.sendMessage({ type: 'reset' }); // a new model deserves fresh alerts
    view.lastOk = null;
  } else if (k === 'ntfyTopic') {
    view.badTopic = !/^[-_A-Za-z0-9]{1,64}$/.test(v);
    if (!view.badTopic) await chrome.storage.local.set({ ntfyTopic: v });
  } else {
    await chrome.storage.local.set({ [k]: v }); // postal: the last one used is remembered
  }
  render();
});

root.addEventListener('click', async (e) => {
  const langBtn = e.target.closest('[data-lang]');
  if (langBtn) {
    tabSet('lang', langBtn.dataset.lang);
    sendPrefs();
    return render();
  }
  const toggle = e.target.closest('[data-ch]');
  if (toggle) {
    const ch = toggle.dataset.ch;
    const c = await getConfig();
    const on = !c.channels[ch];
    tabSet('channels', JSON.stringify({ ...c.channels, [ch]: on }));
    if (ch === 'phone' && on && !c.ntfyTopic) await chrome.storage.local.set({ ntfyTopic: randomTopic() });
    sendPrefs();
    view.testNote = null;
    return render();
  }
  const copyBtn = e.target.closest('[data-copy]');
  if (copyBtn) {
    await navigator.clipboard.writeText($('[data-k=ntfyTopic]').value);
    copyBtn.textContent = t('copied');
    return;
  }
  const btn = e.target.closest('[data-a]');
  if (!btn) return;
  const a = btn.dataset.a;
  if (a === 'toggle') {
    view.running = !view.running;
    if (!view.running) view.nextAt = null;
    tabSet('watching', view.running ? family : '');
    const c = await getConfig();
    chrome.runtime.sendMessage({ type: view.running ? 'start' : 'stop', family, lang: c.lang, channels: c.channels, warn: c.warn });
  } else if (a === 'edit') {
    view.editing = !view.editing;
  } else if (a === 'test') {
    // Tests every alert that's on. The OS can hide notifications, so the panel flashes too.
    const c = await getConfig();
    const on = Object.keys(c.channels).filter((k) => c.channels[k]);
    card.classList.remove('flash');
    void card.offsetWidth;
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 3200);
    view.testNote = await Promise.all(
      on.map(async (k) => [k, await chrome.runtime.sendMessage({ type: 'test', channel: k, lang: c.lang }).catch(() => false)])
    );
  } else if (a === 'ack') {
    stopFlash();
    chrome.runtime.sendMessage({ type: 'ack' });
  } else if (a === 'warn') {
    const c = await getConfig();
    tabSet('warn', c.warn ? 'off' : '');
    sendPrefs();
  } else if (a === 'focusTopic') {
    return $('[data-k=ntfyTopic]').focus(); // the whole box edits the topic, not just the text
  } else if (a === 'newTopic') {
    view.badTopic = false;
    await chrome.storage.local.set({ ntfyTopic: randomTopic() });
  } else if (a === 'clearCookies') {
    btn.disabled = true;
    return chrome.runtime.sendMessage({ type: 'clearCookies' }); // the tab reloads, and a running watch carries on
  } else if (a === 'dismissGap') {
    view.lastGap = null;
    chrome.runtime.sendMessage({ type: 'dismissGap' });
  } else if (a === 'collapse') {
    const c = await getConfig();
    tabSet('collapsed', c.collapsed ? '' : '1');
  }
  render();
});

function applyStatus(s) {
  Object.assign(view, { running: s.running, nextAt: s.nextAt, lastGap: s.lastGap });
  if (s.running) tabSet('watching', family); // only Stop clears it: "not running" may just mean the extension restarted
  render();
}

function showResult(r) {
  view.result = r;
  if (r.ok) {
    view.lastOk = r;
    view.okAt = Date.now();
  }
  render();
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'check') {
    check().then((r) => {
      showResult(r);
      reply(r);
    });
    return true; // async reply
  }
  if (msg.type === 'status') applyStatus(msg);
  if (msg.type === 'found') startFlash();
  if (msg.type === 'ack') stopFlash();
});

(async () => {
  models = listModels(document.documentElement.innerHTML);
  await pickFromUrl();
  await initPanel();
  const status = await chrome.runtime.sendMessage({ type: 'hello', family }).catch(() => null);
  if (status) applyStatus(status);
  sendPrefs();
  // The extension forgets its watches when it updates or Chrome restarts; a tab that was watching
  // this iPhone starts again by itself.
  const was = tabGet('watching');
  if (was !== family) tabSet('watching', '');
  else if (status && !status.running) {
    const c = await getConfig();
    chrome.runtime.sendMessage({ type: 'start', family, lang: c.lang, channels: c.channels, warn: c.warn });
  }
})();
