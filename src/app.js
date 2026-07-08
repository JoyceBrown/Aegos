const fallbackNodes = [
  ['HK', '香港直连诊断', 'hk.aegos.local'],
  ['JP', '日本低延迟', 'jp.aegos.local'],
  ['SG', '新加坡稳定', 'sg.aegos.local'],
  ['TW', '台湾轻负载', 'tw.aegos.local'],
  ['US', '美国备用', 'us.aegos.local'],
  ['GB', '英国备用', 'gb.aegos.local']
];

let latestStatus = null;
let latestGroup = null;
let selectedNode = '';
let startedAt = Date.now();

function $(selector) {
  return document.querySelector(selector);
}

function $all(selector) {
  return [...document.querySelectorAll(selector)];
}

function invoke(command, args = {}) {
  const bridge = window.__TAURI__?.core?.invoke;
  if (!bridge) return Promise.reject(new Error('Tauri bridge unavailable'));
  return bridge(command, args);
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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
    ? items.map((item) => [
        inferRegion(item.name),
        item.name,
        item.server || item.name,
        item.delay ?? -1,
        item.alive !== false,
        item.name === selectedNode || item.name === latestGroup?.now
      ])
    : fallbackNodes.map((row, index) => [...row, -1, true, index === 0]);

  $('#nodeRows').innerHTML = rows.map(([region, name, host, delay, alive, active]) => `
    <div class="row ${active ? 'selected' : ''}" data-node="${escapeHtml(name)}" tabindex="0" role="button" aria-label="选择 ${escapeHtml(name)}">
      <span class="radio"></span>
      <span class="star">☆</span>
      <strong><span class="node-badge">${escapeHtml(region)}</span>${escapeHtml(name)}</strong>
      <span>${escapeHtml(host)}</span>
      <span>${Number(delay) >= 0 ? `${Math.round(delay)} ms` : '-'}</span>
      <span>0.0%</span>
      <span class="load"><span class="bar"></span>38%</span>
      <span>-</span>
      <span class="available">${alive ? '可用' : '不可用'}</span>
      <span class="row-actions">
        <button data-node="${escapeHtml(name)}" aria-label="连接">▷</button>
        <button aria-label="编辑">✎</button>
        <button aria-label="更多">⋯</button>
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
  const modeText = status.mode === 'global' ? '全局代理' : status.mode === 'direct' ? '直连' : '智能分流';

  $('.profile span').textContent = `v${status.appVersion || '0.3.0'}`;
  $('.ring strong').textContent = running ? '已连接' : '未连接';
  $('.ring').classList.toggle('offline', !running);
  $('#nodeName').textContent = activeProfile.name || selectedNode || '等待节点数据';
  $('#nodeHost').textContent = status.network?.proxyEndpoint || '-';
  $('#nodeState').textContent = running ? '可用' : '待连接';
  $('#connectBtn').textContent = running ? '断开连接' : '连接';
  $('#modeLabel').textContent = modeText;
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
      appVersion: '0.3.0',
      mode: 'rule',
      traffic: { up: 0, down: 0 },
      network: { lanIp: '-', proxyEndpoint: '127.0.0.1:7890', outboundIp: '-' },
      settings: { dnsHijackEnabled: true, tunEnabled: false, killSwitchEnabled: false, systemProxy: false },
      protection: { label: '未接管' },
      activeProfile: { name: 'Aegos 本地预览' }
    });
  }
}

async function refreshNodes() {
  try {
    const groups = await invoke('proxy_groups');
    latestGroup = Array.isArray(groups) ? (groups.find((group) => group.name === 'GLOBAL') || groups[0]) : null;
    selectedNode = latestGroup?.now || selectedNode;
    renderRows(latestGroup?.items || []);
  } catch {
    latestGroup = null;
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

async function selectNode(name) {
  if (!name) return;
  selectedNode = name;
  renderRows(latestGroup?.items || []);
  if (!latestGroup?.name || !latestStatus?.running) {
    $('#protectionNotice').textContent = `已选择节点：${name}`;
    return;
  }
  try {
    await invoke('change_proxy', { group: latestGroup.name, proxy: name });
    $('#protectionNotice').textContent = `已切换节点：${name}`;
    await refreshNodes();
  } catch (err) {
    $('#protectionNotice').textContent = `切换节点失败：${err.message || err}`;
  }
}

async function runDiagnostics() {
  try {
    const data = await invoke('diagnostics');
    const passed = data.checks?.filter?.((item) => item.ok).length || 0;
    $('#protectionNotice').textContent = `诊断完成：${passed} 项通过`;
  } catch (err) {
    $('#protectionNotice').textContent = `诊断失败：${err.message || err}`;
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
$('#quickDiagBtn').onclick = runDiagnostics;
$('#quickIpBtn').onclick = () => {
  $('#quickIpBtn').blur();
  refreshStatus();
};
$('#quickTestBtn').onclick = runDiagnostics;
$('#quickNodeBtn').onclick = () => $('.nodes').scrollIntoView({ block: 'nearest' });
$('#setBestBtn').onclick = () => {
  $('#protectionNotice').textContent = selectedNode ? `已设为常用优先：${selectedNode}` : '请先选择一个节点';
};

$all('[data-region]').forEach((button) => {
  button.onclick = () => {
    const region = button.dataset.region;
    const row = $(`#nodeRows .row strong .node-badge`);
    selectedNode = region;
    $('#protectionNotice').textContent = `已筛选地区：${button.textContent.trim()}`;
    row?.scrollIntoView({ block: 'nearest' });
  };
});

$('#nodeRows').addEventListener('click', (event) => {
  const row = event.target.closest('.row[data-node]');
  if (!row) return;
  selectNode(row.dataset.node);
});

$('#nodeRows').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = event.target.closest('.row[data-node]');
  if (!row) return;
  event.preventDefault();
  selectNode(row.dataset.node);
});

renderRows();
wireWindowControls();
refreshStatus();
refreshNodes();
tick();
setInterval(tick, 1000);
setInterval(refreshStatus, 2500);
