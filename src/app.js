const nodes = [
  ['HK', '香港', 'hk.aegos.local'],
  ['JP', '日本', 'jp.aegos.local'],
  ['SG', '新加坡', 'sg.aegos.local'],
  ['TW', '台湾', 'tw.aegos.local'],
  ['US', '美国', 'us.aegos.local']
];

const startedAt = Date.now();

function $(selector) {
  return document.querySelector(selector);
}

function formatClock() {
  const total = Math.floor((Date.now() - startedAt) / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function renderRows() {
  $('#nodeRows').innerHTML = nodes.map(([region, name, host]) => `
    <div class="row">
      <span class="radio"></span>
      <span class="star">☆</span>
      <strong><span class="node-badge">${region}</span>${name}</strong>
      <span>${host}</span>
      <span>-</span>
      <span>0.0%</span>
      <span class="load"><span class="bar"></span>38%</span>
      <span>5.32 GB / 100 GB</span>
      <span class="available">可用</span>
      <span class="row-actions">
        <button aria-label="连接">▷</button>
        <button aria-label="编辑">⌁</button>
        <button aria-label="更多">⋮</button>
      </span>
    </div>
  `).join('');
}

async function loadStatus() {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) return;
  try {
    const status = await invoke('app_status');
    $('#nodeName').textContent = status.node?.name || '香港实验性 IEPL 专线 1';
    $('#nodeHost').textContent = status.node?.host || 'iepl-1.aegos.local';
    $('#protectMode').textContent = status.protection?.systemProxy ? '智能接管' : '未开启';
  } catch {
    // Keep the visual preview data if the native bridge is unavailable.
  }
}

async function wireWindowControls() {
  const appWindow = window.__TAURI__?.window?.getCurrentWindow?.();
  if (!appWindow) return;
  $('#minBtn').onclick = () => appWindow.minimize();
  $('#maxBtn').onclick = () => appWindow.toggleMaximize();
  $('#closeBtn').onclick = () => appWindow.close();
}

function tick() {
  const value = formatClock();
  $('#sessionClock').textContent = value;
  $('#metricClock').textContent = value;
}

renderRows();
loadStatus();
wireWindowControls();
tick();
setInterval(tick, 1000);
