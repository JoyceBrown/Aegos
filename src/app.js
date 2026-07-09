const fallbackNodes = [
  ['HK', '香港直连诊断', 'hk.aegos.local'],
  ['JP', '日本低延迟', 'jp.aegos.local'],
  ['SG', '新加坡稳定', 'sg.aegos.local'],
  ['TW', '台湾轻负载', 'tw.aegos.local'],
  ['US', '美国备用', 'us.aegos.local'],
  ['GB', '英国备用', 'gb.aegos.local']
];

const pageNames = {
  home: '首页',
  nodes: '节点',
  connections: '连接管理',
  profiles: '订阅',
  diagnostics: '诊断',
  logs: '日志',
  settings: '设置'
};

let latestStatus = null;
let latestGroup = null;
let selectedNode = '';
let currentProtocol = 'DIRECT';
let startedAt = Date.now();
let statusBusy = false;
let nodeBusy = false;
let lastStatusAt = 0;

const regionNames = {
  HK: '\u9999\u6e2f',
  JP: '\u65e5\u672c',
  SG: '\u65b0\u52a0\u5761',
  TW: '\u53f0\u6e7e',
  US: '\u7f8e\u56fd',
  GB: '\u82f1\u56fd',
  GL: '\u5168\u7403'
};

function protocolLabel(value = '') {
  const text = String(value || '').toLowerCase();
  if (text.includes('shadowsocks') || text === 'ss') return 'SS';
  if (text.includes('trojan')) return 'Trojan';
  if (text.includes('ssr')) return 'SSR';
  if (text.includes('vmess')) return 'VMess';
  if (text.includes('vless')) return 'VLESS';
  if (text.includes('hysteria')) return 'Hysteria';
  if (text.includes('tuic')) return 'TUIC';
  if (text.includes('wireguard')) return 'WireGuard';
  if (text.includes('direct')) return 'DIRECT';
  return value ? String(value) : 'DIRECT';
}

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

function setNotice(message) {
  $('#protectionNotice').textContent = message;
}

function isPageActive(page) {
  return document.querySelector(`[data-page-panel="${page}"]`)?.classList.contains('active');
}

function setPage(page) {
  const next = pageNames[page] ? page : 'home';
  $all('.nav button').forEach((button) => button.classList.toggle('active', button.dataset.page === next));
  $all('.page').forEach((panel) => panel.classList.toggle('active', panel.dataset.pagePanel === next));
  $('#pageTitle').textContent = pageNames[next];
  if (next === 'connections') refreshConnections();
  if (next === 'diagnostics') runDiagnostics(false);
  if (next === 'logs') renderLogs();
  if (next === 'profiles') renderProfiles();
}

function renderRows(items = []) {
  const rows = items.length
    ? items.map((item) => [
        inferRegion(item.name),
        item.name,
        item.server || item.name,
        item.delay ?? -1,
        item.alive !== false,
        item.name === selectedNode || item.name === latestGroup?.now,
        item.type || item.protocol || 'unknown'
      ])
    : fallbackNodes.map((row, index) => [...row, -1, true, index === 0, 'direct']);

  const recommended = rows
    .filter(([, , , delay, alive]) => alive && Number(delay) >= 0)
    .sort((a, b) => Number(a[3]) - Number(b[3]))[0] || rows[0];
  if (recommended) {
    $('#bestNodeRegion').textContent = regionNames[recommended[0]] || recommended[0];
  }
  const activeRow = rows.find((row) => row[5]) || recommended;
  currentProtocol = protocolLabel(activeRow?.[6] || 'direct');
  $('#protocolState').textContent = currentProtocol;
  $('#protocolMetric').textContent = currentProtocol;

  $('#nodeRows').innerHTML = rows.map(([region, name, host, delay, alive, active, protocol]) => `
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
  $('#homeNodeRows').innerHTML = rows.slice(0, 6).map(([region, name, host, delay, alive, active, protocol]) => `
    <div class="row home-row ${active ? 'selected' : ''}" data-node="${escapeHtml(name)}" tabindex="0" role="button">
      <span class="radio"></span>
      <span class="star">\u2606</span>
      <strong><span class="node-badge">${escapeHtml(region)}</span>${escapeHtml(name)}</strong>
      <span>${escapeHtml(host)}</span>
      <span>${Number(delay) >= 0 ? `${Math.round(delay)} ms` : '-'}</span>
      <span>0.0%</span>
      <span class="load"><span class="bar"></span>38%</span>
      <span>-</span>
      <span class="available">${alive ? '\u53ef\u7528' : '\u4e0d\u53ef\u7528'}</span>
      <span class="row-actions"><button data-node="${escapeHtml(name)}" aria-label="\u8fde\u63a5">\u25b6</button></span>
    </div>
  `).join('');
}

function renderProfiles() {
  const profiles = latestStatus?.settings?.profiles || [];
  $('#profileRows').innerHTML = profiles.map((profile) => `
    <article class="list-card ${profile.id === latestStatus?.settings?.activeProfileId ? 'active' : ''}">
      <div><b>${escapeHtml(profile.name)}</b><small>${escapeHtml(profile.profile_type)} · ${escapeHtml(profile.updated_at || '-')}</small></div>
      <div class="card-actions">
        <button data-profile-switch="${escapeHtml(profile.id)}">启用</button>
        <button data-profile-update="${escapeHtml(profile.id)}">更新</button>
        <button data-profile-remove="${escapeHtml(profile.id)}" ${profile.id === 'direct' ? 'disabled' : ''}>删除</button>
      </div>
    </article>
  `).join('') || '<p class="empty">暂无订阅。</p>';
}

function renderSettings(status) {
  const settings = status.settings || {};
  $('#systemProxyToggle').checked = Boolean(settings.systemProxy);
  $('#startProxyToggle').checked = Boolean(settings.startWithSystemProxy);
  $('#tunToggle').checked = Boolean(settings.tunEnabled);
  $('#dnsToggle').checked = settings.dnsHijackEnabled !== false;
  $('#killToggle').checked = Boolean(settings.killSwitchEnabled);
  $('#ipv6Toggle').checked = Boolean(settings.ipv6Enabled);
  $('#allowLanToggle').checked = Boolean(settings.allowLan);
  $('#mixedPortInput').value = settings.mixedPort || 7890;
  $('#controllerPortInput').value = settings.controllerPort || 19090;
  $('#tunStackSelect').value = settings.tunStack || 'mixed';
  $('#logLevelSelect').value = settings.logLevel || 'info';
}

function renderLogs() {
  const logs = latestStatus?.logs || [];
  $('#logRows').innerHTML = logs.slice(-160).reverse().map((entry) => `
    <div class="log-row"><span>${escapeHtml(entry.at)}</span><b>${escapeHtml(entry.level)}</b><code>${escapeHtml(entry.line)}</code></div>
  `).join('') || '<p class="empty">暂无日志。</p>';
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

  $('#appVersionLabel').textContent = `v${status.appVersion || '0.5.2'}`;
  $('.ring strong').textContent = running ? '已连接' : '未连接';
  $('.ring').classList.toggle('offline', !running);
  $('#nodeName').textContent = activeProfile.name || selectedNode || '等待节点数据';
  const nodeHost = $('#nodeHost');
  if (nodeHost) nodeHost.textContent = status.network?.proxyEndpoint || '-';
  $('#nodeState').textContent = running ? '可用' : '待连接';
  $('#connectBtn').textContent = running ? '断开连接' : '连接';
  $('#modeLabel').textContent = modeText;
  setNotice(`${protection.label || '未接管'}：${running ? '内核正在运行，按当前接管策略处理流量。' : '内核未运行，当前没有流量接管。'}`);

  $('#protectMode').textContent = protection.label || '未接管';
  $('#dnsState').textContent = settings.dnsHijackEnabled === false ? '未开启' : '已开启';
  $('#tunState').textContent = settings.tunEnabled ? '已开启' : '未开启';
  $('#killState').textContent = settings.killSwitchEnabled ? '已开启' : '未开启';
  $('#proxyState').textContent = settings.systemProxy ? '已开启' : '未开启';
  $('#proxyStateRow').classList.toggle('hidden', !settings.systemProxy);
  $('#protocolState').textContent = currentProtocol;
  $('#protocolMetric').textContent = currentProtocol;
  $('#tunHomeToggle').checked = Boolean(settings.tunEnabled);
  $('#tunHomeState').textContent = settings.tunEnabled ? '已开启' : '未开启';
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
  renderSettings(status);
  if (isPageActive('profiles')) renderProfiles();
  if (isPageActive('logs')) renderLogs();
}

async function refreshStatus(force = false) {
  if (statusBusy) return;
  const now = Date.now();
  if (!force && now - lastStatusAt < 1800) return;
  lastStatusAt = now;
  statusBusy = true;
  try {
    renderStatus(await invoke('app_status'));
  } catch {
    renderStatus({
      running: false,
      appVersion: '0.5.2',
      mode: 'rule',
      traffic: { up: 0, down: 0 },
      logs: [],
      network: { lanIp: '-', proxyEndpoint: '127.0.0.1:7890', outboundIp: '-' },
      settings: {
        activeProfileId: 'direct',
        profiles: [],
        mixedPort: 7890,
        controllerPort: 19090,
        startWithSystemProxy: true,
        dnsHijackEnabled: true,
        tunEnabled: false,
        killSwitchEnabled: false,
        systemProxy: false,
        ipv6Enabled: false,
        allowLan: false,
        tunStack: 'mixed',
        logLevel: 'info'
      },
      protection: { label: '未接管' },
      activeProfile: { name: 'Aegos 本地预览' }
    });
  } finally {
    statusBusy = false;
  }
}

async function refreshNodes() {
  if (nodeBusy) return;
  nodeBusy = true;
  try {
    const groups = await invoke('proxy_groups');
    latestGroup = Array.isArray(groups) ? (groups.find((group) => group.name === 'GLOBAL') || groups[0]) : null;
    selectedNode = latestGroup?.now || selectedNode;
    renderRows(latestGroup?.items || []);
  } catch {
    latestGroup = null;
    renderRows();
  } finally {
    nodeBusy = false;
  }
}

async function testNodes() {
  if (nodeBusy) return;
  nodeBusy = true;
  try {
    const groups = await invoke('test_proxy_delays');
    latestGroup = Array.isArray(groups) ? (groups.find((group) => group.name === 'GLOBAL') || groups[0]) : null;
    selectedNode = latestGroup?.now || selectedNode;
    renderRows(latestGroup?.items || []);
    setNotice('节点测速已完成。');
  } catch (err) {
    setNotice(`节点测速失败：${err.message || err}`);
  } finally {
    nodeBusy = false;
  }
}

async function updateActiveProfile() {
  const id = latestStatus?.settings?.activeProfileId;
  if (!id || id === 'direct') {
    setNotice('当前没有可更新的远程订阅。');
    return;
  }
  try {
    await invoke('update_profile', { id });
    await refreshStatus(true);
    await refreshNodes();
    setNotice('订阅已更新。');
  } catch (err) {
    setNotice(`订阅更新失败：${err.message || err}`);
  }
}

async function toggleCore() {
  $('#connectBtn').disabled = true;
  try {
    if (latestStatus?.running) await invoke('stop_core');
    else await invoke('start_core');
    await refreshStatus(true);
    await refreshNodes();
  } catch (err) {
    setNotice(`操作失败：${err.message || err}`);
  } finally {
    $('#connectBtn').disabled = false;
  }
}

async function switchMode() {
  const current = latestStatus?.mode || 'rule';
  const next = current === 'rule' ? 'global' : current === 'global' ? 'direct' : 'rule';
  try {
    await invoke('set_mode', { mode: next });
    await refreshStatus(true);
  } catch (err) {
    setNotice(`切换模式失败：${err.message || err}`);
  }
}

async function selectNode(name) {
  if (!name) return;
  selectedNode = name;
  renderRows(latestGroup?.items || []);
  if (!latestGroup?.name || !latestStatus?.running) {
    setNotice(`已选择节点：${name}`);
    return;
  }
  try {
    await invoke('change_proxy', { group: latestGroup.name, proxy: name });
    setNotice(`已切换节点：${name}`);
    await refreshNodes();
  } catch (err) {
    setNotice(`切换节点失败：${err.message || err}`);
  }
}

async function updateSetting(key, value) {
  try {
    if (key === 'systemProxy') await invoke('set_system_proxy', { enable: Boolean(value) });
    else await invoke('update_setting', { key, value });
    await refreshStatus(true);
    await refreshNodes();
    setNotice('设置已更新。');
  } catch (err) {
    await refreshStatus(true);
    setNotice(`设置失败：${err.message || err}`);
  }
}

async function refreshConnections() {
  try {
    const items = await invoke('connections');
    $('#connectionRows').innerHTML = (Array.isArray(items) ? items : []).map((item) => {
      const chains = Array.isArray(item.chains) ? item.chains.join(' › ') : '-';
      const traffic = `${formatRate(item.upload)} / ${formatRate(item.download)}`;
      const target = item.metadata?.host || item.metadata?.destinationIP || item.id || '-';
      return `<div class="simple-row"><span>${escapeHtml(target)}</span><span>${escapeHtml(item.rule || '-')}</span><span>${escapeHtml(chains)}</span><span>${traffic}</span><button data-close-connection="${escapeHtml(item.id)}">关闭</button></div>`;
    }).join('') || '<p class="empty">当前没有活动连接。</p>';
  } catch (err) {
    $('#connectionRows').innerHTML = `<p class="empty">连接管理不可用：${escapeHtml(err.message || err)}</p>`;
  }
}

async function runDiagnostics(showNotice = true) {
  try {
    const data = await invoke('diagnostics');
    const checks = data.checks || [];
    $('#diagRows').innerHTML = checks.map((item) => `
      <article class="list-card"><div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.detail || '-')}</small></div><span class="${item.ok ? 'ok' : 'bad'}">${item.ok ? '通过' : '异常'}</span></article>
    `).join('');
    if (showNotice) setNotice(`诊断完成：${checks.filter((item) => item.ok).length} 项通过`);
  } catch (err) {
    $('#diagRows').innerHTML = `<p class="empty">诊断失败：${escapeHtml(err.message || err)}</p>`;
    if (showNotice) setNotice(`诊断失败：${err.message || err}`);
  }
}

async function wireWindowControls() {
  $('#minBtn').onclick = () => invoke('window_minimize').catch(() => {});
  $('#maxBtn').onclick = () => invoke('window_toggle_maximize').catch(() => {});
  $('#closeBtn').onclick = () => invoke('window_close').catch(() => {});
  $all('.drag-zone').forEach((zone) => {
    zone.addEventListener('pointerdown', async (event) => {
      if (event.button !== 0 || event.target.closest('button, input, select, textarea')) return;
      try {
        await invoke('window_start_dragging');
      } catch {}
    });
  });
}

function tick() {
  const value = formatClock();
  $('#sessionClock').textContent = value;
  $('#metricClock').textContent = value;
}

$all('.nav button').forEach((button) => {
  button.onclick = () => setPage(button.dataset.page);
});

$('#connectBtn').onclick = toggleCore;
$('#refreshStatusBtn').onclick = () => { refreshStatus(true); refreshNodes(); };
$('#refreshNodesBtn').onclick = refreshNodes;
$('#modeBtn').onclick = switchMode;
$('#quickModeBtn').onclick = switchMode;
$('#quickIpBtn').onclick = () => refreshStatus(true);
$('#quickTestBtn').onclick = testNodes;
$('#quickUpdateSubBtn').onclick = updateActiveProfile;
$('#quickProxyBtn').onclick = () => updateSetting('systemProxy', !latestStatus?.settings?.systemProxy);
$('#quickTunBtn').onclick = () => updateSetting('tunEnabled', !latestStatus?.settings?.tunEnabled);
$('#quickCopyProxyBtn').onclick = () => navigator.clipboard?.writeText(latestStatus?.network?.proxyEndpoint || '127.0.0.1:7890');
$('#quickRestartBtn').onclick = async () => { await invoke('restart_core'); await refreshStatus(true); await refreshNodes(); };
$('#setBestBtn').onclick = () => setNotice(selectedNode ? `已设为常用优先：${selectedNode}` : '请先选择一个节点');
$('#refreshConnectionsBtn').onclick = refreshConnections;
$('#closeAllConnectionsBtn').onclick = async () => { await invoke('close_connections'); refreshConnections(); };
$('#runDiagBtn').onclick = () => runDiagnostics();
$('#clearLogsBtn').onclick = async () => { await invoke('clear_logs'); await refreshStatus(true); };
$('#restartCoreBtn').onclick = async () => { await invoke('restart_core'); await refreshStatus(true); await refreshNodes(); };
$('#savePortBtn').onclick = async () => {
  await updateSetting('mixedPort', Number($('#mixedPortInput').value || 7890));
  await updateSetting('controllerPort', Number($('#controllerPortInput').value || 19090));
  await updateSetting('tunStack', $('#tunStackSelect').value);
  await updateSetting('logLevel', $('#logLevelSelect').value);
};
$('#addProfileBtn').onclick = async () => {
  const url = $('#profileUrlInput').value.trim();
  if (!url) return;
  try {
    await invoke('add_profile_url', { url });
    $('#profileUrlInput').value = '';
    await refreshStatus(true);
    await refreshNodes();
    setNotice('订阅已导入。');
  } catch (err) {
    setNotice(`订阅导入失败：${err.message || err}`);
  }
};
const copyEndpointBtn = $('#copyEndpointBtn');
if (copyEndpointBtn) copyEndpointBtn.onclick = () => navigator.clipboard?.writeText($('#nodeHost')?.textContent || '');

[
  ['systemProxyToggle', 'systemProxy'],
  ['startProxyToggle', 'startWithSystemProxy'],
  ['tunHomeToggle', 'tunEnabled'],
  ['tunToggle', 'tunEnabled'],
  ['dnsToggle', 'dnsHijackEnabled'],
  ['killToggle', 'killSwitchEnabled'],
  ['ipv6Toggle', 'ipv6Enabled'],
  ['allowLanToggle', 'allowLan']
].forEach(([id, key]) => {
  $(`#${id}`).onchange = (event) => updateSetting(key, event.target.checked);
});

$all('[data-region]').forEach((button) => {
  button.onclick = () => {
    selectedNode = button.dataset.region;
    setPage('nodes');
    setNotice(`已筛选地区：${button.textContent.trim()}`);
  };
});

$all('[data-page-jump]').forEach((button) => {
  button.onclick = () => setPage(button.dataset.pageJump);
});

$('#nodeRows').addEventListener('click', (event) => {
  const row = event.target.closest('.row[data-node]');
  if (!row) return;
  selectNode(row.dataset.node);
});

$('#homeNodeRows').addEventListener('click', (event) => {
  const row = event.target.closest('[data-node]');
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

document.body.addEventListener('click', async (event) => {
  const closeId = event.target.closest('[data-close-connection]')?.dataset.closeConnection;
  if (closeId) {
    await invoke('close_connection', { id: closeId });
    refreshConnections();
    return;
  }
  const profileSwitch = event.target.closest('[data-profile-switch]')?.dataset.profileSwitch;
  if (profileSwitch) {
    await invoke('set_active_profile', { id: profileSwitch });
    await refreshStatus(true);
    return;
  }
  const profileUpdate = event.target.closest('[data-profile-update]')?.dataset.profileUpdate;
  if (profileUpdate) {
    await invoke('update_profile', { id: profileUpdate });
    await refreshStatus(true);
    return;
  }
  const profileRemove = event.target.closest('[data-profile-remove]')?.dataset.profileRemove;
  if (profileRemove) {
    await invoke('remove_profile', { id: profileRemove });
    await refreshStatus(true);
  }
});

renderRows();
wireWindowControls();
refreshStatus(true);
refreshNodes();
tick();
setInterval(tick, 1000);
setInterval(refreshStatus, 8000);
