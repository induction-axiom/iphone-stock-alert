// Runs on the iPhone Duo buy page. Does the actual availability request (same origin, your own
// cookies) when background.js asks, and shows a small control panel.
const { regionPrefix, findPart, availabilityUrl, parseAvailability } = DuoParse;

const DEFAULT_PRODUCT = 'iPhone Duo 256GB Star White';
const prefix = regionPrefix(location.pathname);
let audioCtx = null;
let sirenTimer = null;

async function getConfig() {
  const c = await chrome.storage.local.get(['postal', 'part', 'partPrefix', 'product', 'running']);
  c.product = c.product || DEFAULT_PRODUCT;
  return c;
}

async function detectPart() {
  const c = await getConfig();
  // Part numbers differ per country (LL/A in the US, VC/A in Canada...), so re-detect per region.
  if (c.part && c.partPrefix === prefix) return c.part;
  const part = findPart(document.documentElement.innerHTML, c.product);
  if (part) await chrome.storage.local.set({ part, partPrefix: prefix });
  return part;
}

async function check() {
  const c = await getConfig();
  if (!c.postal) return { ok: false, error: '还没填邮编' };
  const part = c.part || (await detectPart());
  if (!part) return { ok: false, error: '没在页面里找到 ' + c.product + ' 的型号，请手动填写' };

  let res;
  try {
    res = await fetch(availabilityUrl(prefix, part, c.postal), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
  } catch (e) {
    return { ok: false, error: '网络错误：' + e.message };
  }
  const text = await res.text();
  if (res.status !== 200) return { ok: false, status: res.status, error: 'HTTP ' + res.status + (res.status === 541 ? '（被 Apple 暂时限制）' : '') };
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, status: res.status, error: '返回的不是 JSON（可能被限制）' };
  }
  try {
    return { ok: true, part, ...parseAvailability(data, part) };
  } catch (e) {
    console.warn('[Duo Watch] raw response', data);
    return { ok: false, error: e.message };
  }
}

// ---------- alarm inside the page (backup for the Mac helper) ----------

function unlockAudio() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function startSiren() {
  if (sirenTimer) return;
  let n = 0;
  const flash = setInterval(() => {
    document.title = n++ % 2 ? '🚨 有货！有货！' : '📱 iPhone Duo 有货';
    panel.style.background = n % 2 ? '#d00' : '#fff';
  }, 500);
  const beep = () => {
    if (!audioCtx || audioCtx.state !== 'running') return;
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
  sirenTimer = { flash, beep: setInterval(beep, 700) };
}

function stopSiren() {
  if (!sirenTimer) return;
  clearInterval(sirenTimer.flash);
  clearInterval(sirenTimer.beep);
  sirenTimer = null;
  panel.style.background = '#fff';
}

// ---------- control panel ----------

const panel = document.createElement('div');
panel.style.cssText =
  'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:340px;max-height:60vh;overflow:auto;' +
  'background:#fff;color:#111;border:2px solid #111;border-radius:12px;padding:12px;' +
  'font:13px/1.4 -apple-system,system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.25)';
panel.innerHTML = `
  <div style="font-weight:700;font-size:15px;margin-bottom:6px">Duo Watch</div>
  <label>邮编 <input data-k="postal" style="width:110px" placeholder="例如 M5V 3L9"></label>
  <label style="margin-left:6px">型号 <input data-k="part" style="width:100px" placeholder="自动识别"></label>
  <div style="margin:8px 0">
    <button data-a="toggle" style="font-weight:700;padding:4px 12px"></button>
    <button data-a="ack" style="padding:4px 12px">停止报警</button>
  </div>
  <div data-v="status" style="color:#555"></div>
  <div data-v="stores" style="margin-top:6px"></div>`;
document.body.appendChild(panel);
const $ = (s) => panel.querySelector(s);

async function renderConfig() {
  const c = await getConfig();
  $('[data-k=postal]').value = c.postal || '';
  $('[data-k=part]').value = c.part || '';
  $('[data-a=toggle]').textContent = c.running ? '■ 停止监控' : '▶ 开始监控';
}

panel.addEventListener('change', async (e) => {
  const k = e.target.dataset.k;
  if (!k) return;
  const v = e.target.value.trim();
  await chrome.storage.local.set(k === 'part' ? { part: v, partPrefix: prefix } : { [k]: v });
});

panel.addEventListener('click', async (e) => {
  const a = e.target.dataset.a;
  unlockAudio(); // any click on the panel counts as the user gesture Chrome needs for sound
  if (a === 'toggle') {
    const c = await getConfig();
    chrome.runtime.sendMessage({ type: c.running ? 'stop' : 'start' });
    await chrome.storage.local.set({ running: !c.running });
    renderConfig();
  } else if (a === 'ack') {
    stopSiren();
    chrome.runtime.sendMessage({ type: 'ack' });
  }
});

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function renderResult(r) {
  const time = new Date().toLocaleTimeString();
  if (!r.ok) {
    $('[data-v=status]').innerHTML = `<b style="color:#c00">${time} 出错：</b>${esc(r.error)}`;
    return;
  }
  const n = r.stores.filter((s) => s.available).length;
  $('[data-v=status]').innerHTML =
    `${time} 已检查 ${r.stores.length} 家店（${esc(r.location)}）：` +
    (n ? `<b style="color:#c00">${n} 家有货！</b>` : '都没货') +
    (r.delivery ? `<br>网上订送货：${esc(r.delivery)}` : '');
  $('[data-v=stores]').innerHTML = r.stores
    .map((s) => `<div style="color:${s.available ? '#c00;font-weight:700' : '#888'}">${s.available ? '✅' : '·'} ${esc(s.name)} ${esc(s.distance)} — ${esc(s.quote || s.display)}</div>`)
    .join('');
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'check') {
    check().then((r) => {
      renderResult(r);
      reply(r);
    });
    return true; // async reply
  }
  if (msg.type === 'found') startSiren();
  if (msg.type === 'ack') stopSiren();
  if (msg.type === 'reload') location.reload();
});

(async () => {
  await detectPart();
  await renderConfig();
  chrome.runtime.sendMessage({ type: 'hello' });
})();
