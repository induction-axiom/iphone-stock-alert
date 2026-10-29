// Runs on the iPhone Duo buy page. Does the actual availability request (same origin, your own
// cookies) when background.js asks, and shows a draggable control panel.
const { regionPrefix, findPart, availabilityUrl, parseAvailability } = DuoParse;

const TARGET = { capacity: '256gb', color: 'starwhite', label: '256GB · Star White' };
const prefix = regionPrefix(location.pathname);
let audioCtx = null;
let siren = null;
let lang = 'en';
const view = { running: false, ringing: false, result: null, checkedAt: null, nextAt: null, helperOk: null };

const STRINGS = {
  en: {
    noPostal: 'Enter your postal code in Settings first',
    noPart: (label) => `Couldn't find the ${label} part number on this page. Enter it in Settings.`,
    network: (m) => 'Network error: ' + m,
    http: (s) => `HTTP ${s}` + (s === 541 ? ': temporarily blocked by Apple' : ''),
    notJson: 'Response was not JSON (probably blocked)',
    badShape: 'Unrecognized response format',
    apple: (m) => 'Apple says: ' + m,
    flashA: '🚨 IN STOCK!',
    flashB: '📱 iPhone Duo in stock',
    found: (n) => `In stock at ${n} store${n > 1 ? 's' : ''}!`,
    paused: 'Paused',
    starting: 'Starting…',
    failing: "Can't check right now",
    none: 'Not in stock yet',
    partPending: 'part pending',
    last: (t) => `Last ${t}`,
    never: 'Not checked yet',
    next: (n) => ` · next in ${n}s`,
    helperOn: '● Mac alarm connected',
    helperOff: '○ Mac alarm not running',
    yes: 'Available',
    no: 'None',
    delivery: (d) => `Ship to home: ${d}`,
    settings: 'Settings',
    postal: 'Postal / ZIP code',
    part: 'Part number (blank = auto)',
    auto: 'auto',
    start: 'Start watching',
    stop: 'Stop',
    ack: 'Silence alarm',
    collapse: 'Collapse / expand',
  },
  zh: {
    noPostal: '请先在设置里填邮编',
    noPart: (label) => `没在页面里找到 ${label} 的型号，请在设置里手动填写`,
    network: (m) => '网络错误：' + m,
    http: (s) => `HTTP ${s}` + (s === 541 ? '，被 Apple 暂时限制' : ''),
    notJson: '返回的不是 JSON（可能被限制）',
    badShape: '响应格式不认识',
    apple: (m) => 'Apple 返回：' + m,
    flashA: '🚨 有货！有货！',
    flashB: '📱 iPhone Duo 有货',
    found: (n) => `有货！${n} 家店可取`,
    paused: '已暂停',
    starting: '正在开始…',
    failing: '暂时查不到',
    none: '暂时没货',
    partPending: '型号待识别',
    last: (t) => `上次 ${t}`,
    never: '还没查过',
    next: (n) => ` · ${n} 秒后再查`,
    helperOn: '● Mac 报警助手已连接',
    helperOff: '○ Mac 报警助手未运行',
    yes: '可取货',
    no: '无货',
    delivery: (d) => `网上订购送货：${d}`,
    settings: '设置',
    postal: '邮编',
    part: '型号（留空自动识别）',
    auto: '自动识别',
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

async function getConfig() {
  return chrome.storage.local.get(['postal', 'part', 'partPrefix', 'running', 'panelPos', 'collapsed', 'lang']);
}

async function detectPart() {
  const c = await getConfig();
  // Part numbers differ per country (LL/A in the US, VC/A in Canada...), so re-detect per region.
  if (c.part && c.partPrefix === prefix) return c.part;
  const part = findPart(document.documentElement.innerHTML, TARGET.capacity, TARGET.color);
  if (part) await chrome.storage.local.set({ part, partPrefix: prefix });
  return part;
}

// Results keep an error key plus arguments, so switching language re-renders them correctly.
async function check() {
  const c = await getConfig();
  if (!c.postal) return { ok: false, err: ['noPostal'] };
  const part = (c.partPrefix === prefix && c.part) || (await detectPart());
  if (!part) return { ok: false, err: ['noPart', TARGET.label] };

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
    return { ok: true, part, ...parseAvailability(data, part) };
  } catch (e) {
    console.warn('[Duo Watch] raw response', data);
    return { ok: false, err: e.code === 'apple' ? ['apple', e.message] : ['badShape'] };
  }
}

// ---------- alarm inside the page (backup for the Mac helper) ----------

function unlockAudio() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function startSiren() {
  if (siren) return;
  view.ringing = true;
  let n = 0;
  const flash = setInterval(() => {
    document.title = n++ % 2 ? t('flashA') : t('flashB');
  }, 500);
  const beep = () => {
    // The Mac helper does the talking; the page only beeps when the helper isn't running.
    if (view.helperOk !== false || !audioCtx || audioCtx.state !== 'running') return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(880, audioCtx.currentTime);
    o.frequency.setValueAtTime(1320, audioCtx.currentTime + 0.25);
    g.gain.value = 0.6;
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.5);
  };
  beep();
  siren = { flash, beep: setInterval(beep, 700) };
  render();
}

function stopSiren() {
  view.ringing = false;
  if (siren) {
    clearInterval(siren.flash);
    clearInterval(siren.beep);
    siren = null;
  }
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
  }
  @media (prefers-color-scheme: dark) {
    .card { --bg: rgba(28,28,30,.88); --fg: #f5f5f7; --muted: #a1a1a6; --line: rgba(255,255,255,.1);
            --chip: rgba(255,255,255,.08); --green: #30d158; --red: #ff453a; --amber: #ffb340; --blue: #0a84ff; }
  }
  .bar { display: flex; align-items: center; gap: 8px; padding: 10px 12px 10px 14px; cursor: grab; user-select: none; }
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
  .body { padding: 0 14px 14px; }
  .collapsed .body { display: none; }
  .headline { font-size: 22px; font-weight: 700; letter-spacing: -.02em; margin: 2px 0 2px; }
  .sub { color: var(--muted); font-size: 12px; }
  .meta { display: flex; justify-content: space-between; gap: 8px; margin: 10px 0 8px; color: var(--muted); font-size: 12px; }
  .stores { border-top: 1px solid var(--line); max-height: 220px; overflow: auto; }
  .row { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--line); }
  .row .name { flex: 1; min-width: 0; }
  .row .name b { font-weight: 500; }
  .row .name small { display: block; color: var(--muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .dist { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .pill { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--chip); color: var(--muted); white-space: nowrap; }
  .pill.yes { background: var(--green); color: #fff; }
  .note { margin-top: 8px; color: var(--muted); font-size: 12px; }
  .err { margin-top: 8px; padding: 8px 10px; border-radius: 10px; background: color-mix(in srgb, var(--amber) 14%, transparent); color: var(--fg); font-size: 12px; }
  details { margin-top: 10px; }
  summary { cursor: pointer; color: var(--muted); font-size: 12px; list-style: none; }
  summary::before { content: '▸ '; }
  details[open] summary::before { content: '▾ '; }
  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
  label { display: grid; gap: 3px; color: var(--muted); font-size: 11px; }
  input { all: unset; box-sizing: border-box; width: 100%; padding: 6px 8px; border-radius: 8px; background: var(--chip);
          color: var(--fg); font-size: 13px; border: 1px solid transparent; }
  input:focus { border-color: var(--blue); }
  .actions { display: flex; gap: 8px; margin-top: 12px; }
  button.btn { all: unset; flex: 1; text-align: center; padding: 8px 12px; border-radius: 10px; font-weight: 600; cursor: pointer; }
  .btn.primary { background: var(--blue); color: #fff; }
  .btn.secondary { background: var(--chip); color: var(--fg); }
  .btn.danger { background: var(--red); color: #fff; }
  .btn:hover { filter: brightness(1.08); }
  [hidden] { display: none !important; }

  .card[data-state="ok"] .dot { background: var(--green); box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 25%, transparent); }
  .card[data-state="error"] .dot { background: var(--amber); }
  .card[data-state="found"] { border-color: var(--red); animation: pulse 1s ease-in-out infinite; }
  .card[data-state="found"] .dot { background: var(--red); }
  .card[data-state="found"] .headline { color: var(--red); }
  @keyframes pulse { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--red) 45%, transparent), 0 12px 40px rgba(0,0,0,.18); } }
  .running .dot { animation: breathe 2s ease-in-out infinite; }
  @keyframes breathe { 50% { opacity: .45; } }
</style>
<div class="card" data-state="idle">
  <div class="bar" data-drag>
    <span class="dot"></span><span class="title">Duo Watch</span><span class="mini"></span>
    <span class="grow"></span>
    <div class="lang"><button data-lang="en">EN</button><button data-lang="zh">中</button></div>
    <button class="icon" data-a="collapse">–</button>
  </div>
  <div class="body">
    <div class="headline"></div>
    <div class="sub"></div>
    <div class="meta"><span data-v="times"></span><span data-v="helper"></span></div>
    <div class="stores"></div>
    <div class="note" data-v="delivery"></div>
    <div class="err" data-v="error" hidden></div>
    <details>
      <summary data-t="settings"></summary>
      <div class="fields">
        <label><span data-t="postal"></span><input data-k="postal" placeholder="95014 / M5V 3L9"></label>
        <label><span data-t="part"></span><input data-k="part"></label>
      </div>
    </details>
    <div class="actions">
      <button class="btn primary" data-a="toggle"></button>
      <button class="btn danger" data-a="ack" data-t="ack" hidden></button>
    </div>
  </div>
</div>`;
document.documentElement.appendChild(host);
const $ = (s) => root.querySelector(s);
const card = $('.card');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clock = (ts) => new Date(ts).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

async function render() {
  const c = await getConfig();
  lang = c.lang === 'zh' ? 'zh' : 'en';
  root.querySelectorAll('[data-t]').forEach((el) => (el.textContent = t(el.dataset.t)));
  root.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
  $('[data-k=part]').placeholder = t('auto');
  $('[data-a=collapse]').title = t('collapse');

  const r = view.result;
  const found = r && r.ok ? r.stores.filter((s) => s.available) : [];
  const state = found.length || view.ringing ? 'found' : !view.running ? 'idle' : r && !r.ok ? 'error' : r ? 'ok' : 'idle';
  card.dataset.state = state;
  card.classList.toggle('running', view.running);

  let headline;
  if (found.length) headline = t('found', found.length);
  else if (!view.running) headline = t('paused');
  else if (!r) headline = t('starting');
  else if (!r.ok) headline = t('failing');
  else headline = t('none');
  $('.headline').textContent = headline;
  $('.mini').textContent = headline;
  $('.sub').textContent = `iPhone Duo ${TARGET.label} · ${c.part || t('partPending')}${c.postal ? ' · ' + c.postal : ''}`;

  const left = view.nextAt ? Math.max(0, Math.round((view.nextAt - Date.now()) / 1000)) : null;
  $('[data-v=times]').textContent =
    (view.checkedAt ? t('last', clock(view.checkedAt)) : t('never')) + (view.running && left != null ? t('next', left) : '');
  $('[data-v=helper]').textContent = view.helperOk == null ? '' : view.helperOk ? t('helperOn') : t('helperOff');
  $('[data-v=helper]').style.color = view.helperOk === false ? 'var(--amber)' : '';

  const showError = r && !r.ok;
  $('[data-v=error]').hidden = !showError;
  if (showError) $('[data-v=error]').textContent = t(...r.err);
  $('.stores').innerHTML =
    r && r.ok
      ? r.stores
          .map(
            (s) => `<div class="row"><div class="name"><b>${esc(s.name)}</b><small>${esc(s.quote || s.display)}</small></div>
              <span class="dist">${esc(s.distance)}</span><span class="pill ${s.available ? 'yes' : ''}">${s.available ? t('yes') : t('no')}</span></div>`
          )
          .join('')
      : '';
  $('.stores').hidden = !(r && r.ok && r.stores.length);
  $('[data-v=delivery]').textContent = r && r.ok && r.delivery ? t('delivery', r.delivery) : '';

  $('[data-a=toggle]').textContent = view.running ? t('stop') : t('start');
  $('[data-a=toggle]').className = 'btn ' + (view.running ? 'secondary' : 'primary');
  $('[data-a=ack]').hidden = !view.ringing;
  card.classList.toggle('collapsed', !!c.collapsed);
  $('[data-a=collapse]').textContent = c.collapsed ? '+' : '–';
}

async function initPanel() {
  const c = await getConfig();
  view.running = !!c.running;
  $('[data-k=postal]').value = c.postal || '';
  $('[data-k=part]').value = c.part || '';
  if (!c.postal) $('details').open = true;
  if (c.panelPos) placeAt(c.panelPos.x, c.panelPos.y);
  render();
  setInterval(() => view.running && render(), 1000);
}

// Dragging by the title bar; the position is remembered across reloads.
function placeAt(x, y) {
  const w = host.offsetWidth || 340;
  const h = host.offsetHeight || 60;
  x = Math.min(Math.max(8, x), innerWidth - w - 8);
  y = Math.min(Math.max(8, y), innerHeight - h - 8);
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
    if (pos) chrome.storage.local.set({ panelPos: pos });
  };
  bar.addEventListener('pointermove', move);
  bar.addEventListener('pointerup', up);
});

root.addEventListener('change', async (e) => {
  const k = e.target.dataset && e.target.dataset.k;
  if (!k) return;
  const v = e.target.value.trim();
  await chrome.storage.local.set(k === 'part' ? { part: v, partPrefix: prefix } : { [k]: v });
  if (k === 'part' && !v) $('[data-k=part]').value = (await detectPart()) || '';
  render();
});

root.addEventListener('click', async (e) => {
  unlockAudio(); // any click on the panel counts as the user gesture Chrome needs for sound
  const langBtn = e.target.closest('[data-lang]');
  if (langBtn) {
    await chrome.storage.local.set({ lang: langBtn.dataset.lang });
    return render();
  }
  const btn = e.target.closest('[data-a]');
  if (!btn) return;
  const a = btn.dataset.a;
  if (a === 'toggle') {
    view.running = !view.running;
    if (!view.running) view.nextAt = null;
    await chrome.storage.local.set({ running: view.running });
    chrome.runtime.sendMessage({ type: view.running ? 'start' : 'stop' });
  } else if (a === 'ack') {
    stopSiren();
    chrome.runtime.sendMessage({ type: 'ack' });
  } else if (a === 'collapse') {
    const c = await getConfig();
    await chrome.storage.local.set({ collapsed: !c.collapsed });
  }
  render();
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'check') {
    check().then((r) => {
      view.result = r;
      view.checkedAt = Date.now();
      render();
      // background.js and the Mac helper get the error as text in the current language
      reply(r.ok ? r : { ...r, error: t(...r.err) });
    });
    return true; // async reply
  }
  if (msg.type === 'status') {
    Object.assign(view, { running: msg.running, nextAt: msg.nextAt, helperOk: msg.helperOk });
    render();
  }
  if (msg.type === 'found') startSiren();
  if (msg.type === 'ack') stopSiren();
  if (msg.type === 'reload') location.reload();
});

(async () => {
  await detectPart();
  await initPanel();
  chrome.runtime.sendMessage({ type: 'hello' });
})();
