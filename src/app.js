const fallbackNodes = [
  ['HK', '香港', 'hk.aegos.local'],
  ['JP', '日本', 'jp.aegos.local'],
  ['SG', '新加坡', 'sg.aegos.local'],
  ['TW', '台湾', 'tw.aegos.local'],
  ['US', '美国', 'us.aegos.local']
];

let latestStatus = null;
let startedAt = Date.now();

function $(selector) {
  return document.querySelector(selector);
}

function invoke(command, args = {}) {
  const bridge = window.__TAURI__?.core?.invoke;
  if (!bridge) return Promise.reject(new Error('Tauri bridge unavailable'));
  return bridge(command, args);
}

function formatClock() {
  const total = latestStatus?.running ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatRate(value) {
  const n = Number(value || 0);
  if (n < 1024) return `${n} B/s`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB/s`;
  return `${(n / 1024 / 1024).toFixed(2)} MB/s`;
}

function inferRegion(name = '') {
  const text = String(name).toLowerCase();
  if (/hong|香港|\bhk\b/.test(text)) return 'HK';
  if (/japan|日本|东京|大阪|\bjp\b/.test(text)) return 'JP';
  if (/singapore|新加坡|\bsg\b/.test(text)) return 'SG';
  if (/taiwan|台湾|\btw\b/.test(text)) return 'TW';
  if (/united states|usa|美国|\bus\b/.test(text)) return 'US';
  if (/britain|uk|英国|\bgb\b/.test(text)) return 'GB';
  return 'GL';
}

function renderRows(items = []) {
  const rows = items.length
    ? items.map((item) => [inferRegion(item.name), item.name, item.server || item.name, item.delay ?? -1, item.alive !== false])
    : fallbackNodes.map((row) => [...row, -1, true]);

  $('#nodeRows').innerHTML = rows.map(([region, name, host, delay, alive]) => `
    <div class="row">
      <span class="radio"></span>
      <span class="star">☆</span>
      <strong><span class="node-badge">${region}</span>${name}</strong>
      <span>${host}</span>
      <span>${Number(delay) >= 0 ? `${Math.round(delay)} ms` : '-'}</span>
      <span>0.0%</span>
      <span class="load"><span class="bar"></span>38%</span>
      <span>-</span>
      <span class="available">${alive ? '可用' : '不可用'}</span>
      <span class="row-actions">
        <button data-node="${name}" aria-label="连接">▷</button>
        <button aria-label="编辑">⌁</button>
        <button aria-label="更多">⋮</button>
      </span>
    </div>
  `).join('');
}

function renderStatus(status) {
  const wasRunning = latestStatus?.running;
  latestStatus = status;
  if (status.running && !wasRunning) startedAt = Date.now();
  if (!status.running) startedAt = Date.now();

  const settings = status.settings || {};
  const protection = status.protection || {};
  const activeProfile = status.activeProfile || {};
  const traffic = status.traffic || {};
  const running = Boolean(status.running && status.controller !== false);

  $('.profile span').textContent = `v${status.appVersion || '0.2.0'}`;
  $('.ring strong').textContent = running ? '已连接' : '未连接';
  $('.ring').classList.toggle('offline', !running);
  $('#nodeName').textContent = activeProfile.name || '等待节点数据';
  $('#nodeHost').textContent = status.network?.proxyEndpoint || '-';
  $('#nodeState').textContent = running ? '可用' : '待连接';
  $('#connectBtn').textContent = running ? '断开连接' : '连接';
  $('#modeLabel').textContent = status.mode === 'global' ? '全局代理' : status.mode === 'direct' ? '直连' : '智能分流';
  $('#protectionNotice').textContent = `${protection.label || '未接管'}：${running ? '内核正在运行，按当前接管策略处理流量。' : '内核未运行，当前没有流量接管。'}`;

  $('#protectMode').textContent = protection.label || '未开启';
  $('#dnsState').textContent = settings.dnsHijackEnabled === false ? '未开启' : '已开启';
  $('#tunState').textContent = settings.tunEnabled ? '已开启' : '未开启';
  $('#killState').textContent = settings.killSwitchEnabled ? '已开启' : '未开启';
  $('#proxyState').textContent = settings.systemProxy ? '已开启' : '未开启';
  $('#lanIpState').textContent = status.network?.lanIp || '-';
  $('#proxyPortState').textContent = status.network?.proxyEndpoint || '-';
  $('#outboundIpState').textContent = status.network?.outboundIp || '-';
  $('#proxyMetric').textContent = status.network?.proxyEndpoint || '-';
  $('#outboundMetric').textContent = status.network?.outboundIp || '-';

  const up = formatRate(traffic.up);
  const down = formatRate(traffic.down);
  $('#upRate').textContent = up;
  $('#downRate').textContent = down;
  $('#sideUpRate').textContent = `↑ ${up}`;
  $('#sideDownRate').textContent = `↓ ${down}`;
}

async function refreshStatus() {
  try {
    renderStatus(await invoke('app_status'));
  } catch {
    renderStatus({
      running: false,
      appVersion: '0.2.0',
      mode: 'rule',
      traffic: { up: 0, down: 0 },
      network: { lanIp: '-', proxyEndpoint: '127.0.0.1:7890', outboundIp: '-' },
      settings: { dnsHijackEnabled: true, tunEnabled: false, killSwitchEnabled: false, systemProxy: false },
      protection: { label: '未接管' },
      activeProfile: { name: 'Aegos 视觉预览' }
    });
  }
}

async function refreshNodes() {
  try {
    const groups = await invoke('proxy_groups');
    const primary = Array.isArray(groups) ? (groups.find((group) => group.name === 'GLOBAL') || groups[0]) : null;
    renderRows(primary?.items || []);
  } catch {
    renderRows();
  }
}

async function toggleCore() {
  $('#connectBtn').disabled = true;
  try {
    if (latestStatus?.running) await invoke('stop_core');
    else await invoke('start_core');
    await refreshStatus();
    await refreshNodes();
  } catch (err) {
    $('#protectionNotice').textContent = `操作失败：${err.message || err}`;
  } finally {
    $('#connectBtn').disabled = false;
  }
}

async function switchMode() {
  const current = latestStatus?.mode || 'rule';
  const next = current === 'rule' ? 'global' : current === 'global' ? 'direct' : 'rule';
  try {
    await invoke('set_mode', { mode: next });
    await refreshStatus();
  } catch (err) {
    $('#protectionNotice').textContent = `切换模式失败：${err.message || err}`;
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

$('#connectBtn').onclick = toggleCore;
$('#refreshStatusBtn').onclick = () => { refreshStatus(); refreshNodes(); };
$('#refreshNodesBtn').onclick = refreshNodes;
$('#modeBtn').onclick = switchMode;
$('#quickModeBtn').onclick = switchMode;
$('#quickDiagBtn').onclick = async () => {
  try {
    const data = await invoke('diagnostics');
    $('#protectionNotice').textContent = `诊断完成：${data.checks?.filter?.((item) => item.ok).length || 0} 项通过`;
  } catch (err) {
    $('#protectionNotice').textContent = `诊断失败：${err.message || err}`;
  }
};

renderRows();
wireWindowControls();
refreshStatus();
refreshNodes();
tick();
setInterval(tick, 1000);
setInterval(refreshStatus, 1800);
