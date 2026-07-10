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
let homeRegionFilter = '';
let nodePageFilter = 'all';
let nodeSearchKeyword = '';
let logFilter = 'all';
let speedTestTimer = null;
let lastSpeedNodeRefreshAt = 0;
let recoveryBusy = false;
let lastRecoveryAt = 0;
let pageLoadTimer = null;
let pageLoadToken = 0;
let foregroundBusy = 0;
let backgroundJobBusy = 0;
let lastBackgroundJobError = '';
let lastUserInputAt = 0;
let lastUiHeartbeatAt = performance.now();
let latestDiagnostics = null;
let jobCenterSyncBusy = false;
let jobCenterLastSyncAt = 0;
const jobRecords = new Map();
const terminalJobStates = new Set(['succeeded', 'failed', 'cancelled']);
const recentInvokes = [];

const uiStore = {
  state: {
    page: 'home',
    homeRegionFilter: '',
    nodePageFilter: 'all'
  },
  listeners: new Set(),
  set(patch) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener(this.state));
  },
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
};

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

function modeLabel(mode = '') {
  if (mode === 'global') return '\u5168\u5c40\u4ee3\u7406';
  if (mode === 'direct') return '\u76f4\u8fde';
  return '\u667a\u80fd\u5206\u6d41';
}

function formatProxyPort(endpoint = '') {
  const text = String(endpoint || '').trim();
  const match = text.match(/:(\d{2,5})$/);
  return match ? match[1] : (text || '-');
}

function $(selector) {
  return document.querySelector(selector);
}

function $all(selector) {
  return [...document.querySelectorAll(selector)];
}

const defaultAppVersion = ($('#appVersionLabel')?.textContent || 'v0.0.0').replace(/^v/i, '').trim() || '0.0.0';
const defaultMixedPort = 7891;
const defaultControllerPort = 19091;
const speedTestPollMs = 300;
const speedTestNodeRefreshMs = 1200;
const logRenderLimit = 80;
const nodeRenderLimit = 36;
const homeNodeRenderLimit = 8;
const pageNavSettleMs = 550;
const foregroundQuietMs = 1800;
const freezeWarnMs = 500;
const freezeBadMs = 1500;
const pageCacheTtlMs = {
  connections: 15000,
  diagnostics: 30000,
  profiles: 15000,
  logs: 5000
};
const navButtons = new Map($all('.nav button').map((button) => [button.dataset.page, button]));
const pagePanels = new Map($all('.page').map((panel) => [panel.dataset.pagePanel, panel]));
const pageTitleEl = $('#pageTitle');
let renderedPage = '';
let renderedHomeRegionFilter = null;
let renderedNodePageFilter = null;
let lastNavAt = 0;
const pageCacheState = {
  connections: { loaded: false, loading: false, updatedAt: 0 },
  diagnostics: { loaded: false, loading: false, updatedAt: 0 },
  profiles: { loaded: false, loading: false, updatedAt: 0 },
  logs: { loaded: false, loading: false, updatedAt: 0 }
};

function invoke(command, args = {}) {
  const bridge = window.__TAURI__?.core?.invoke;
  if (!bridge) return Promise.reject(new Error('Tauri bridge unavailable'));
  const startedAt = performance.now();
  const record = { command, startedAt, state: 'pending', duration: 0 };
  recentInvokes.push(record);
  if (recentInvokes.length > 16) recentInvokes.shift();
  return bridge(command, args)
    .then((result) => {
      record.state = 'ok';
      record.duration = Math.round(performance.now() - startedAt);
      return result;
    })
    .catch((err) => {
      record.state = 'error';
      record.duration = Math.round(performance.now() - startedAt);
      throw err;
    });
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

function regionLabel(region) {
  return regionNames[region] || region || '全球';
}

function normalizeRows(items = []) {
  return items.length
    ? items.map((item) => {
        const delay = Number(item.delay ?? -1);
        const healthStatus = item.healthStatus || (delay === 0 ? 'testing' : delay > 0 ? 'available' : 'unknown');
        const score = Number(item.healthScore ?? (delay > 0 ? delay : 999999));
        return [
          inferRegion(item.name),
          item.name,
          item.server || item.name,
          delay,
          item.alive !== false || delay === 0,
          item.name === selectedNode || item.name === latestGroup?.now,
          item.type || item.protocol || 'unknown',
          healthStatus,
          Number(item.medianDelay ?? delay),
          Number(item.jitter ?? 0),
          score,
          Boolean(item.recommended),
          Number(item.failureStreak ?? 0)
        ];
      })
    : fallbackNodes.map((row, index) => [...row, -1, true, index === 0, 'direct', 'unknown', -1, 0, 999999, false, 0]);
}

function filterRows(rows, filter) {
  if (filter === 'low') {
    return [...rows]
      .filter(([, , , delay, alive, , , healthStatus]) => alive && healthStatus !== 'cooldown' && Number(delay) > 0 && Number(delay) < 100)
      .sort((a, b) => Number(a[10]) - Number(b[10]) || Number(a[3]) - Number(b[3]));
  }
  if (filter === 'asia') return rows.filter(([region]) => ['HK', 'JP', 'SG', 'TW'].includes(region));
  if (filter === 'europe') return rows.filter(([region]) => ['GB'].includes(region));
  if (filter === 'north-america') return rows.filter(([region]) => ['US'].includes(region));
  if (filter === 'favorite' || filter === 'recent') return rows.filter((row) => row[5]);
  return rows;
}

function isNodeSurfaceActive(page = uiStore.state.page) {
  return page === 'home' || page === 'nodes';
}

function normalizeNodeItem(item = {}, index = 0) {
  const delay = Number(item.delay ?? -1);
  const healthStatus = item.healthStatus || (delay === 0 ? 'testing' : delay > 0 ? 'available' : 'unknown');
  const score = Number(item.healthScore ?? (delay > 0 ? delay : 999999));
  const name = item.name || `Node ${index + 1}`;
  return [
    inferRegion(name),
    name,
    item.server || name,
    delay,
    item.alive !== false || delay === 0,
    name === selectedNode || name === latestGroup?.now,
    item.type || item.protocol || 'unknown',
    healthStatus,
    Number(item.medianDelay ?? delay),
    Number(item.jitter ?? 0),
    score,
    Boolean(item.recommended),
    Number(item.failureStreak ?? 0)
  ];
}

function rowMatchesNodeFilter(row, filter) {
  if (filter === 'low') {
    const delay = Number(row[3]);
    return row[4] && row[7] !== 'cooldown' && delay > 0 && delay < 100;
  }
  if (filter === 'asia') return ['HK', 'JP', 'SG', 'TW'].includes(row[0]);
  if (filter === 'europe') return row[0] === 'GB';
  if (filter === 'north-america') return row[0] === 'US';
  if (filter === 'favorite' || filter === 'recent') return row[5];
  return true;
}

function itemMatchesNodeSearch(item = {}, keyword = nodeSearchKeyword) {
  if (!keyword) return true;
  return `${item.name || ''} ${item.server || ''}`.toLowerCase().includes(keyword);
}

function compareBestRows(a, b) {
  return Number(b[11]) - Number(a[11]) || Number(a[10]) - Number(b[10]) || Number(a[3]) - Number(b[3]);
}

function rememberBestRow(bestRows, row) {
  const delay = Number(row[3]);
  if (!row[4] || row[7] === 'cooldown' || delay <= 0 || delay >= 100) return;
  bestRows.push(row);
  bestRows.sort(compareBestRows);
  if (bestRows.length > 3) bestRows.length = 3;
}

function delayClass(value) {
  const delay = Number(value);
  if (delay > 0 && delay < 100) return 'delay-good';
  if (delay >= 100) return 'delay-bad';
  if (delay === 0) return 'delay-testing';
  return 'delay-muted';
}

/*
function renderNodeRow([region, name, host, delay, alive, active]) {
  const statusText = Number(delay) >= 0 ? '可用' : (alive ? '待测速' : '不可用');
  return `
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
  `;
}

function renderHomeNodeRow([region, name, host, delay, alive, active]) {
  const statusText = Number(delay) >= 0 ? '可用' : (alive ? '待测速' : '不可用');
  return `
    <div class="row home-row ${active ? 'selected' : ''}" data-node="${escapeHtml(name)}" tabindex="0" role="button" aria-label="选择 ${escapeHtml(name)}">
      <span class="radio"></span>
      <span class="star">☆</span>
      <strong><span class="node-badge">${escapeHtml(region)}</span>${escapeHtml(name)}</strong>
      <span>${escapeHtml(host)}</span>
      <span>${Number(delay) >= 0 ? `${Math.round(delay)} ms` : '-'}</span>
      <span>0.0%</span>
      <span class="available">${alive ? '可用' : '不可用'}</span>
    </div>
  `;
}

*/

function renderNodeRow([region, name, host, delay, alive, active, protocol, healthStatus, medianDelay, jitter, score, recommended, failureStreak]) {
  const delayValue = Number(delay);
  const delayText = delayValue > 0 ? `${Math.round(delayValue)} ms` : (delayValue === 0 ? '\u6d4b\u901f\u4e2d' : '-');
  const delayState = delayClass(delayValue);
  const statusText = healthStatus === 'cooldown' ? '\u51b7\u5374\u4e2d'
    : recommended ? '\u63a8\u8350'
    : delayValue > 0 ? (failureStreak > 0 ? '\u4e0d\u7a33\u5b9a' : '\u53ef\u7528')
    : (delayValue === 0 ? '\u6d4b\u901f\u4e2d' : (alive ? '\u5f85\u6d4b\u901f' : '\u4e0d\u53ef\u7528'));
  return `
    <div class="row ${active ? 'selected' : ''}" data-node="${escapeHtml(name)}" tabindex="0" role="button" aria-label="select ${escapeHtml(name)}">
      <span class="radio"></span>
      <span class="star">&#9734;</span>
      <strong><span class="node-badge">${escapeHtml(region)}</span>${escapeHtml(name)}</strong>
      <span>${escapeHtml(protocolLabel(protocol))} / ${escapeHtml(host)}</span>
      <span class="${delayState}">${delayText}</span>
      <span>${Number(medianDelay) > 0 ? `${Math.round(Number(medianDelay))} ms` : '-'}</span>
      <span class="load"><span class="bar"></span>${Math.max(0, Math.min(99, Math.round(100 - Math.min(Number(score) || 99, 99))))}%</span>
      <span>${Number(jitter) > 0 ? `${Math.round(Number(jitter))} ms` : '-'}</span>
      <span class="available">${escapeHtml(statusText)}</span>
      <span class="row-actions">
        <button data-node="${escapeHtml(name)}" aria-label="connect">&#9655;</button>
        <button aria-label="edit">&#9998;</button>
        <button aria-label="more">&#8943;</button>
      </span>
    </div>
  `;
}

function renderHomeNodeRow([region, name, host, delay, alive, active, protocol, healthStatus, medianDelay, jitter, score, recommended, failureStreak]) {
  const delayValue = Number(delay);
  const delayText = delayValue > 0 ? `${Math.round(delayValue)} ms` : (delayValue === 0 ? '\u6d4b\u901f\u4e2d' : '-');
  const delayState = delayClass(delayValue);
  const statusText = healthStatus === 'cooldown' ? '\u51b7\u5374'
    : recommended ? '\u63a8\u8350'
    : delayValue > 0 ? (failureStreak > 0 ? '\u4e0d\u7a33' : '\u53ef\u7528')
    : (delayValue === 0 ? '\u6d4b\u901f\u4e2d' : (alive ? '\u5f85\u6d4b\u901f' : '\u4e0d\u53ef\u7528'));
  return `
    <div class="row home-row ${active ? 'selected' : ''}" data-node="${escapeHtml(name)}" tabindex="0" role="button" aria-label="select ${escapeHtml(name)}">
      <span class="radio"></span>
      <span class="star">&#9734;</span>
      <strong><span class="node-badge">${escapeHtml(region)}</span>${escapeHtml(name)}</strong>
      <span>${escapeHtml(protocolLabel(protocol))} / ${escapeHtml(host)}</span>
      <span class="${delayState}">${delayText}</span>
      <span>0.0%</span>
      <span class="available">${escapeHtml(statusText)}</span>
    </div>
  `;
}

function noticeLevel(message = '') {
  const text = String(message).toLowerCase();
  if (/失败|异常|错误|不可用|缺失|failed|error|exception/.test(text)) return 'bad';
  if (/需要|警告|warning|not elevated|require|权限|冲突/.test(text)) return 'warn';
  if (/正在|中\.\.\.|请求|测速|导入|更新|同步|running|pending/.test(text)) return 'info';
  return 'ok';
}

function setNotice(message) {
  const notice = $('#protectionNotice');
  const level = noticeLevel(message);
  notice.textContent = message;
  notice.classList.toggle('is-bad', level === 'bad');
  notice.classList.toggle('is-warn', level === 'warn');
  notice.classList.toggle('is-info', level === 'info');
}

function recordUserInteraction() {
  lastUserInputAt = Date.now();
}

function isForegroundHot() {
  return Date.now() - Math.max(lastUserInputAt, lastNavAt) < foregroundQuietMs;
}

function appendLocalLog(level, category, line) {
  const entry = {
    at: new Date().toISOString(),
    level,
    category,
    line
  };
  if (latestStatus) {
    latestStatus = {
      ...latestStatus,
      logs: [...(latestStatus.logs || []), entry].slice(-700)
    };
    if (isPageActive('logs')) renderLogs();
  }
  console[level === 'error' ? 'error' : 'warn'](`[Aegos ${category}] ${line}`);
}

function startUiFreezeWatchdog() {
  setInterval(() => {
    const now = performance.now();
    const lag = now - lastUiHeartbeatAt;
    lastUiHeartbeatAt = now;
    if (lag < freezeWarnMs) return;
    const pending = recentInvokes
      .filter((item) => item.state === 'pending')
      .map((item) => `${item.command}:${Math.round(now - item.startedAt)}ms`)
      .join(', ') || '-';
    const recent = recentInvokes
      .slice(-5)
      .map((item) => `${item.command}:${item.state}:${item.duration || Math.round(now - item.startedAt)}ms`)
      .join(', ') || '-';
    const line = `UI freeze ${Math.round(lag)}ms; page=${uiStore.state.page}; nodeItems=${latestGroup?.items?.length || 0}; speedPolling=${Boolean(speedTestTimer)}; fgBusy=${foregroundBusy}; bgBusy=${backgroundJobBusy}; pending=[${pending}]; recent=[${recent}]`;
    appendLocalLog(lag >= freezeBadMs ? 'error' : 'warn', 'debug', line);
  }, 250);
}

window.addEventListener('unhandledrejection', (event) => {
  setNotice(`操作异常：${event.reason?.message || event.reason || '未知错误'}`);
});

window.addEventListener('error', (event) => {
  setNotice(`界面异常：${event.message || '未知错误'}`);
});

['pointerdown', 'click', 'keydown', 'input'].forEach((eventName) => {
  window.addEventListener(eventName, recordUserInteraction, { capture: true, passive: true });
});

function setButtonBusy(button, busy, label) {
  if (!button) return;
  if (!button.dataset.idleText) button.dataset.idleText = button.textContent;
  button.classList.toggle('busy', busy);
  button.classList.toggle('is-pending', busy);
  button.setAttribute('aria-busy', busy ? 'true' : 'false');
  button.dataset.busy = busy ? 'true' : '';
  button.textContent = busy ? label : button.dataset.idleText;
}

async function runButtonAction(button, busyLabel, action) {
  if (button?.dataset.busy === 'true') return null;
  setButtonBusy(button, true, busyLabel);
  try {
    return await runForegroundAction(action);
  } finally {
    setButtonBusy(button, false);
  }
}

async function runForegroundAction(action) {
  foregroundBusy += 1;
  try {
    return await action();
  } finally {
    foregroundBusy = Math.max(0, foregroundBusy - 1);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeJob(job = {}) {
  const updatedAt = Number(job.updated_at || job.updatedAt || job.started_at || job.startedAt || Math.floor(Date.now() / 1000));
  return {
    ...job,
    state: job.state || 'running',
    label: job.label || job.kind || 'Job',
    message: job.message || job.error || '',
    progress: Number(job.progress || 0),
    total: Number(job.total || 0),
    updatedAt
  };
}

function rememberJob(job) {
  if (!job?.id) return;
  const existing = jobRecords.get(job.id) || {};
  const normalized = normalizeJob({
    ...existing,
    ...job,
    payload: job.payload ?? existing.payload
  });
  jobRecords.set(normalized.id, normalized);
  const sorted = [...jobRecords.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  sorted.slice(12).forEach((item) => jobRecords.delete(item.id));
  renderJobCenter();
}

function jobStateLabel(state = '') {
  if (state === 'succeeded') return '\u5b8c\u6210';
  if (state === 'failed') return '\u5931\u8d25';
  if (state === 'cancelled') return '\u5df2\u53d6\u6d88';
  if (state === 'queued') return '\u6392\u961f';
  return '\u8fd0\u884c\u4e2d';
}

function jobProgressText(job) {
  const total = Number(job.total || 0);
  const progress = Number(job.progress || 0);
  if (total > 1) return `${Math.min(progress, total)}/${total}`;
  return jobStateLabel(job.state);
}

function renderJobCenter() {
  const box = $('#jobRows');
  if (!box) return;
  const jobs = [...jobRecords.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);
  if (!jobs.length) {
    box.innerHTML = '<p class="empty">&#26242;&#26080;&#21518;&#21488;&#20219;&#21153;</p>';
    return;
  }
  box.innerHTML = jobs.map((job) => {
    const state = terminalJobStates.has(job.state) ? job.state : 'running';
    const action = state === 'running'
      ? `<button data-job-cancel="${escapeHtml(job.id)}">&#21462;&#28040;</button>`
      : state !== 'succeeded'
        ? `<button data-job-retry="${escapeHtml(job.id)}">&#37325;&#35797;</button>`
        : '';
    return `
      <article class="job-row ${escapeHtml(state)}">
        <div>
          <b>${escapeHtml(job.label)}</b>
          <small>${escapeHtml(job.message || job.kind || '-')}</small>
        </div>
        <span>${escapeHtml(jobProgressText(job))}</span>
        ${action}
      </article>
    `;
  }).join('');
}

async function syncJobCenter(force = false) {
  const hasActive = [...jobRecords.values()].some((job) => !terminalJobStates.has(job.state));
  if (!force && !hasActive) return;
  if (!force && isForegroundHot()) return;
  if (!force && Date.now() - jobCenterLastSyncAt < 1800) return;
  if (jobCenterSyncBusy) return;
  jobCenterSyncBusy = true;
  jobCenterLastSyncAt = Date.now();
  try {
    const jobs = await invoke('job_status', {});
    if (Array.isArray(jobs)) jobs.forEach(rememberJob);
  } catch {
  } finally {
    jobCenterSyncBusy = false;
  }
}

async function requestJobCancel(id) {
  if (!id) return;
  try {
    const job = await invoke('cancel_job', { id });
    rememberJob(job);
    setNotice('已发送后台任务取消请求。');
  } catch (err) {
    setNotice(`取消后台任务失败：${err.message || err}`);
  }
}

async function retryJob(id) {
  const job = jobRecords.get(id);
  if (!job?.kind) return;
  setNotice(`正在重试后台任务：${job.label || job.kind}`);
  await runBackgroundJob(job.kind, job.payload || {});
}

async function runBackgroundJob(kind, payload = {}, options = {}) {
  backgroundJobBusy += 1;
  try {
    if (options.pendingNotice) setNotice(options.pendingNotice);
    const started = await invoke('start_job', { kind, payload });
    rememberJob({ ...started, payload });
    let job = started;
    while (job && !['succeeded', 'failed', 'cancelled'].includes(job.state)) {
      await sleep(options.pollMs || 350);
      job = await invoke('job_status', { id: started.id });
      rememberJob(job);
      if (options.progressNotice) {
        const message = options.progressNotice(job);
        if (message) setNotice(message);
      } else if (job?.message) {
        const total = Number(job.total || 0);
        const progress = Number(job.progress || 0);
        setNotice(total > 1 ? `${job.label}：${job.message} ${progress}/${total}` : `${job.label}：${job.message}`);
      }
    }
    if (job?.state === 'succeeded') {
      rememberJob(job);
      const value = job.result;
      lastBackgroundJobError = '';
      if (options.onSuccess) await options.onSuccess(value, job);
      if (options.successNotice) setNotice(resolveMessage(options.successNotice, value));
      return value;
    }
    const reason = job?.error || job?.message || '后台任务失败';
    rememberJob(job);
    lastBackgroundJobError = reason;
    if (options.failureNotice) setNotice(resolveMessage(options.failureNotice, new Error(reason)));
    else setNotice(`${job?.label || '后台任务'}失败：${reason}`);
    return null;
  } catch (err) {
    lastBackgroundJobError = err.message || String(err);
    if (options.failureNotice) setNotice(resolveMessage(options.failureNotice, err));
    else setNotice(`后台任务异常：${err.message || err}`);
    return null;
  } finally {
    backgroundJobBusy = Math.max(0, backgroundJobBusy - 1);
  }
}

function cloneUiValue(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function snapshotUiState() {
  return {
    latestStatus: cloneUiValue(latestStatus),
    latestGroup: cloneUiValue(latestGroup),
    selectedNode,
    uiState: cloneUiValue(uiStore.state),
    homeRegionFilter,
    nodePageFilter
  };
}

function restoreUiState(snapshot) {
  latestStatus = cloneUiValue(snapshot.latestStatus);
  latestGroup = cloneUiValue(snapshot.latestGroup);
  selectedNode = snapshot.selectedNode || '';
  uiStore.set(snapshot.uiState || {
    page: uiStore.state.page,
    homeRegionFilter: snapshot.homeRegionFilter || '',
    nodePageFilter: snapshot.nodePageFilter || 'all'
  });
  if (latestStatus) renderStatus(latestStatus);
  renderRows(latestGroup?.items || []);
}

function resolveMessage(message, value) {
  return typeof message === 'function' ? message(value) : message;
}

async function runOptimisticAction(options) {
  const snapshot = options.snapshot?.() || snapshotUiState();
  foregroundBusy += 1;
  try {
    options.apply?.(snapshot);
    const pendingNotice = resolveMessage(options.pendingNotice);
    if (pendingNotice) setNotice(pendingNotice);
    const result = await options.commit?.();
    await options.refresh?.(result);
    const successNotice = resolveMessage(options.successNotice, result);
    if (successNotice) setNotice(successNotice);
    return result;
  } catch (err) {
    if (options.rollback) options.rollback(snapshot, err);
    else restoreUiState(snapshot);
    const failureNotice = resolveMessage(options.failureNotice, err) || `操作失败：${err.message || err}`;
    setNotice(failureNotice);
    return null;
  } finally {
    foregroundBusy = Math.max(0, foregroundBusy - 1);
  }
}

function isPageActive(page) {
  return document.querySelector(`[data-page-panel="${page}"]`)?.classList.contains('active');
}

function runWhenIdle(task, timeout = 1200) {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(task, { timeout });
    return;
  }
  setTimeout(task, 0);
}

function markPageCache(page) {
  if (!pageCacheState[page]) return;
  pageCacheState[page].loaded = true;
  pageCacheState[page].loading = false;
  pageCacheState[page].updatedAt = Date.now();
}

function shouldRefreshPageCache(page) {
  const state = pageCacheState[page];
  if (!state || state.loading) return false;
  return !state.loaded || Date.now() - state.updatedAt > (pageCacheTtlMs[page] || 15000);
}

function renderUiState(state = uiStore.state) {
  homeRegionFilter = state.homeRegionFilter || '';
  nodePageFilter = state.nodePageFilter || 'all';
  const page = pageNames[state.page] ? state.page : 'home';
  if (renderedPage !== page) {
    navButtons.get(renderedPage)?.classList.remove('active');
    pagePanels.get(renderedPage)?.classList.remove('active');
    navButtons.get(page)?.classList.add('active');
    pagePanels.get(page)?.classList.add('active');
    renderedPage = page;
  }
  if (pageTitleEl) pageTitleEl.textContent = pageNames[page];
  if (renderedHomeRegionFilter !== homeRegionFilter) {
    $all('[data-region]').forEach((button) => button.classList.toggle('active', button.dataset.region === homeRegionFilter));
    renderedHomeRegionFilter = homeRegionFilter;
  }
  if (renderedNodePageFilter !== nodePageFilter) {
    $all('[data-node-filter]').forEach((button) => button.classList.toggle('active', button.dataset.nodeFilter === nodePageFilter));
    renderedNodePageFilter = nodePageFilter;
  }
}

function setPage(page) {
  const next = pageNames[page] ? page : 'home';
  lastNavAt = Date.now();
  if (uiStore.state.page !== next) {
    uiStore.set({ page: next });
  }
  schedulePageLoad(next);
  if (isNodeSurfaceActive(next) && pendingRowItems) {
    scheduleRowsRender(pendingRowItems, { force: true, delay: 80 });
  }
}

function schedulePageLoad(page) {
  pageLoadToken += 1;
  const token = pageLoadToken;
  if (pageLoadTimer) clearTimeout(pageLoadTimer);
  pageLoadTimer = setTimeout(() => {
    if (token !== pageLoadToken || uiStore.state.page !== page) return;
    if (Date.now() - lastNavAt < pageNavSettleMs) return;
    runWhenIdle(() => {
      if (token !== pageLoadToken || uiStore.state.page !== page) return;
      if (foregroundBusy > 0) return;
      if (page === 'connections' && shouldRefreshPageCache(page)) refreshConnections(token);
      if (page === 'diagnostics' && shouldRefreshPageCache(page)) {
        renderCachedDiagnostics();
        markPageCache(page);
      }
      if (page === 'logs' && shouldRefreshPageCache(page)) {
        renderLogs();
        markPageCache(page);
      }
      if (page === 'profiles' && shouldRefreshPageCache(page)) {
        renderProfiles();
        markPageCache(page);
      }
    });
  }, pageNavSettleMs);
}

let rowRenderFrame = null;
let pendingRowItems = null;
const rowRenderSettleMs = 320;

function scheduleRowsRender(items = latestGroup?.items || [], options = {}) {
  pendingRowItems = items;
  if (!options.force && !isNodeSurfaceActive()) return;
  if (rowRenderFrame) clearTimeout(rowRenderFrame);
  const run = () => {
    rowRenderFrame = null;
    const nextItems = pendingRowItems || [];
    pendingRowItems = null;
    renderRows(nextItems);
  };
  rowRenderFrame = setTimeout(run, options.delay ?? rowRenderSettleMs);
}

function renderRows(items = []) {
  const sourceItems = items.length
    ? items
    : fallbackNodes.map(([region, name, server]) => ({ name, server, type: 'direct', region, delay: -1, alive: true }));
  const bestRows = [];
  const fallbackBestRows = [];
  const nodeRows = [];
  const homeRows = [];
  let activeRow = null;
  let matchingNodeCount = 0;

  for (let index = 0; index < sourceItems.length; index += 1) {
    const item = sourceItems[index];
    if (!itemMatchesNodeSearch(item)) continue;
    const row = normalizeNodeItem(item, index);
    rememberBestRow(bestRows, row);
    if (fallbackBestRows.length < 3) fallbackBestRows.push(row);
    if (!activeRow && row[5]) activeRow = row;
    if (rowMatchesNodeFilter(row, nodePageFilter)) {
      matchingNodeCount += 1;
      if (nodeRows.length < nodeRenderLimit) nodeRows.push(row);
    }
    if (
      homeRows.length < homeNodeRenderLimit
      && (!homeRegionFilter || row[0] === homeRegionFilter)
    ) {
      homeRows.push(row);
    }
  }

  const visibleBestRows = bestRows.length ? bestRows : fallbackBestRows;
  $('#bestNodeList').innerHTML = visibleBestRows.map(([region, name, , delay, , , protocol, healthStatus, , , , isRecommended]) => `
    <button class="best-chip" data-node="${escapeHtml(name)}">
      <span class="flag">${escapeHtml(region)}</span>
      <b>${escapeHtml(regionLabel(region))}${isRecommended ? ' / \u63a8\u8350' : ''}</b>
      <small>${Number(delay) > 0 ? `${Math.round(delay)} ms` : Number(delay) === 0 ? '\u6d4b\u901f\u4e2d' : '\u5f85\u6d4b\u901f'} / ${escapeHtml(protocolLabel(protocol))} / ${healthStatus === 'cooldown' ? '\u51b7\u5374' : '\u53ef\u5019\u9009'}</small>
    </button>
  `).join('');

  activeRow = activeRow || visibleBestRows[0];
  currentProtocol = protocolLabel(activeRow?.[6] || 'direct');
  $('#protocolState').textContent = currentProtocol;
  $('#protocolMetric').textContent = currentProtocol;
  if (activeRow?.[1]) $('#nodeName').textContent = activeRow[1];

  const overflowNotice = matchingNodeCount > nodeRows.length
    ? `<p class="empty">\u5df2\u663e\u793a\u524d ${nodeRows.length} \u4e2a\u8282\u70b9\uff0c\u8bf7\u641c\u7d22\u6216\u7b5b\u9009\u7f29\u5c0f\u8303\u56f4\u3002</p>`
    : '';
  $('#nodeRows').innerHTML = nodeRows.map(renderNodeRow).join('') + overflowNotice || '<p class="empty">\u6682\u65e0\u7b26\u5408\u6761\u4ef6\u7684\u8282\u70b9\u3002</p>';
  $('#homeNodeRows').innerHTML = (homeRows.length ? homeRows : fallbackBestRows).slice(0, homeNodeRenderLimit)
    .map(renderHomeNodeRow)
    .join('');
}

function renderProfiles() {
  const profiles = latestStatus?.settings?.profiles || [];
  $('#profileRows').innerHTML = profiles.map((profile) => `
    <article class="list-card ${profile.id === latestStatus?.settings?.activeProfileId ? 'active' : ''}" data-profile-row="${escapeHtml(profile.id)}" tabindex="0" role="button">
      <div><b>${escapeHtml(profile.name)}</b><small>${escapeHtml(profile.profile_type)} · ${escapeHtml(profile.updated_at || '-')}</small></div>
      <small class="profile-source-summary">${Number(profile.node_count || profile.nodeCount || 0)} nodes</small>
      <div class="card-actions">
        <button data-profile-switch="${escapeHtml(profile.id)}">启用</button>
        <button data-profile-update="${escapeHtml(profile.id)}">更新</button>
        <button data-profile-remove="${escapeHtml(profile.id)}" ${profile.id === 'direct' ? 'disabled' : ''}>删除</button>
      </div>
    </article>
  `).join('') || '<p class="empty">暂无订阅。</p>';
}

function profilePendingText(label = 'syncing') {
  const labels = {
    syncing: '\u540c\u6b65\u4e2d',
    updating: '\u66f4\u65b0\u4e2d',
    importing: '\u5bfc\u5165\u4e2d'
  };
  return labels[label] || label;
}

function profileSummaryText(profile) {
  const nodes = Number(profile.node_count ?? profile.nodeCount ?? 0);
  const groups = Number(profile.proxy_group_count ?? profile.proxyGroupCount ?? 0);
  const suffix = profile.metadataStatus === 'repaired'
    ? ` / ${'\u5df2\u4fee\u590d'}`
    : profile.metadataStatus === 'stale'
      ? ` / ${'\u9700\u66f4\u65b0'}`
      : '';
  return groups > 0 ? `${nodes} nodes / ${groups} groups${suffix}` : `${nodes} nodes${suffix}`;
}

function ensureTakeoverControls() {
  const summaryGrid = document.querySelector('.settings-summary-grid');
  if (summaryGrid && !$('#settingsTakeoverSummary')) {
    const item = document.createElement('article');
    item.innerHTML = '<span>恢复策略</span><b id="settingsTakeoverSummary">接管时记录</b>';
    summaryGrid.appendChild(item);
  }
  const proxySection = $('#systemProxyToggle')?.closest('.settings-section');
  if (proxySection && !$('#repairProxyBtn')) {
    const actions = document.createElement('div');
    actions.className = 'settings-actions';
    actions.innerHTML = '<button id="repairProxyBtn" class="ghost">修复接管</button>';
    proxySection.appendChild(actions);
    $('#repairProxyBtn').onclick = (event) => runButtonAction(event.currentTarget, '修复中...', repairSystemProxyJob);
  }
}

renderProfiles = function renderProfiles() {
  const profiles = latestStatus?.settings?.profiles || [];
  $('#profileRows').innerHTML = profiles.map((profile) => {
    const pending = Boolean(profile.uiPending);
    const summary = pending ? profilePendingText(profile.uiPendingLabel) : profileSummaryText(profile);
    return `
    <article class="list-card ${profile.id === latestStatus?.settings?.activeProfileId ? 'active' : ''} ${pending ? 'is-pending' : ''}" data-profile-row="${escapeHtml(profile.id)}" tabindex="0" role="button" aria-busy="${pending ? 'true' : 'false'}">
      <div><b>${escapeHtml(profile.name)}</b><small>${escapeHtml(profile.profile_type)} / ${escapeHtml(profile.updated_at || '-')}</small></div>
      <small class="profile-source-summary">${escapeHtml(summary)}</small>
      <div class="card-actions">
        <button data-profile-switch="${escapeHtml(profile.id)}">\u542f\u7528</button>
        <button data-profile-update="${escapeHtml(profile.id)}">\u66f4\u65b0</button>
        <button data-profile-remove="${escapeHtml(profile.id)}" ${profile.id === 'direct' ? 'disabled' : ''}>\u5220\u9664</button>
      </div>
    </article>
  `;
  }).join('') || '<p class="empty">\u6682\u65e0\u8ba2\u9605\u3002</p>';
};

function renderSettings(status) {
  const settings = status.settings || {};
  const reliability = settings.reliability || {};
  const permissions = status.permissions || {};
  ensureTakeoverControls();
  const adminState = $('#adminState');
  if (adminState) {
    adminState.textContent = permissions.isAdmin ? '管理员运行中' : '普通权限';
    adminState.classList.toggle('ok', Boolean(permissions.isAdmin));
    adminState.classList.toggle('bad', !permissions.isAdmin);
  }
  const mixedPort = settings.mixedPort || defaultMixedPort;
  const controllerPort = settings.controllerPort || defaultControllerPort;
  $('#settingsPortSummary').textContent = String(mixedPort);
  $('#settingsControllerSummary').textContent = String(controllerPort);
  const takeover = settings.proxyTakeover || {};
  const takeoverSummary = $('#settingsTakeoverSummary');
  if (takeoverSummary) {
    takeoverSummary.textContent = takeover.snapshotCaptured ? '可恢复原代理' : '接管时记录';
    takeoverSummary.classList.toggle('ok', Boolean(takeover.snapshotCaptured));
  }
  $('#settingsRuntimeSummary').textContent = latestStatus?.running
    ? (settings.tunEnabled ? 'TUN 接管中' : settings.systemProxy ? '系统代理接管' : '核心运行中')
    : '未接管';
  $('#settingsProxySummary').textContent = settings.systemProxy ? '系统代理已开启' : '系统代理未开启';
  $('#settingsReliabilitySummary').textContent = reliability.auto === false
    ? '自动自愈关闭'
    : `自动自愈开启 / ${reliability.candidateLimit || 24} 候选`;
  $('#systemProxyToggle').checked = Boolean(settings.systemProxy);
  $('#startProxyToggle').checked = Boolean(settings.startWithSystemProxy);
  $('#tunToggle').checked = Boolean(settings.tunEnabled);
  $('#dnsToggle').checked = settings.dnsHijackEnabled !== false;
  $('#killToggle').checked = Boolean(settings.killSwitchEnabled);
  $('#ipv6Toggle').checked = Boolean(settings.ipv6Enabled);
  $('#allowLanToggle').checked = Boolean(settings.allowLan);
  $('#mixedPortInput').value = mixedPort;
  $('#controllerPortInput').value = controllerPort;
  $('#tunStackSelect').value = settings.tunStack || 'mixed';
  $('#logLevelSelect').value = settings.logLevel || 'info';
  $('#reliabilityAutoToggle').checked = reliability.auto !== false;
  $('#profileFailoverToggle').checked = reliability.profileFailover !== false;
  $('#reliabilityMaxDelayInput').value = reliability.maxDelayMs || 800;
  $('#reliabilityCandidateLimitInput').value = reliability.candidateLimit || 24;
}

function logCategoryLabel(category = '', level = '') {
  const key = category || (level === 'core' ? 'core' : 'runtime');
  const labels = {
    user: '\u7528\u6237',
    runtime: '\u8fd0\u884c',
    core: '\u6838\u5fc3',
    diagnostic: '\u8bca\u65ad',
    debug: '\u8c03\u8bd5'
  };
  return labels[key] || labels.runtime;
}

function renderLogs() {
  const allLogs = latestStatus?.logs || [];
  const logs = logFilter === 'all'
    ? allLogs
    : allLogs.filter((entry) => (entry.category || (entry.level === 'core' ? 'core' : 'runtime')) === logFilter);
  $all('[data-log-filter]').forEach((button) => button.classList.toggle('active', button.dataset.logFilter === logFilter));
  $('#logRows').innerHTML = logs.slice(-logRenderLimit).reverse().map((entry) => `
    <div class="log-row"><span>${escapeHtml(entry.at)}</span><b>${escapeHtml(entry.level)}</b><em>${escapeHtml(logCategoryLabel(entry.category, entry.level))}</em><code>${escapeHtml(entry.line)}</code></div>
  `).join('') || '<p class="empty">\u6682\u65e0\u5339\u914d\u65e5\u5fd7\u3002</p>';
}

function warmStaticPageCaches() {
  if (!latestStatus) return;
  if (!pageCacheState.profiles.loaded) {
    renderProfiles();
    markPageCache('profiles');
  }
  if (!pageCacheState.logs.loaded) {
    renderLogs();
    markPageCache('logs');
  }
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
  const running = Boolean(status.running);
  const modeText = modeLabel(status.mode);

  $('#appVersionLabel').textContent = `v${status.appVersion || defaultAppVersion}`;
  $('.ring strong').textContent = running ? '已连接' : '未连接';
  $('.ring').classList.toggle('offline', !running);
  $('#nodeName').textContent = selectedNode || latestGroup?.now || activeProfile.name || '等待节点数据';
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
  $('#proxyPortState').textContent = formatProxyPort(status.network?.proxyEndpoint);
  $('#outboundIpState').textContent = status.network?.outboundIp || '-';
  $('#proxyMetric').textContent = formatProxyPort(status.network?.proxyEndpoint);
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
  warmStaticPageCaches();
}

function applyOptimisticMode(mode) {
  if (latestStatus) latestStatus = { ...latestStatus, mode };
  $('#modeLabel').textContent = modeLabel(mode);
}

function applyOptimisticProfile(profileId) {
  if (!latestStatus?.settings) return;
  const profiles = latestStatus.settings.profiles || [];
  const profile = profiles.find((item) => item.id === profileId);
  latestStatus = {
    ...latestStatus,
    activeProfile: profile ? { ...(latestStatus.activeProfile || {}), ...profile } : latestStatus.activeProfile,
    settings: { ...latestStatus.settings, activeProfileId: profileId }
  };
  renderProfiles();
}

function applyOptimisticNode(name) {
  selectedNode = name;
  if (latestGroup) latestGroup = { ...latestGroup, now: name };
  renderRows(latestGroup?.items || []);
}

function applyOptimisticSetting(key, value) {
  if (!latestStatus?.settings) return;
  if (key === 'reliabilityAuto' || key === 'reliabilityProfileFailover') {
    const reliability = latestStatus.settings.reliability || {};
    latestStatus = {
      ...latestStatus,
      settings: {
        ...latestStatus.settings,
        reliability: {
          ...reliability,
          [key === 'reliabilityAuto' ? 'auto' : 'profileFailover']: Boolean(value)
        }
      }
    };
    renderStatus(latestStatus);
    return;
  }
  latestStatus = {
    ...latestStatus,
    settings: { ...latestStatus.settings, [key]: value }
  };
  renderStatus(latestStatus);
}

function applyOptimisticProfileRemove(profileId) {
  if (!latestStatus?.settings) return;
  const profiles = latestStatus.settings.profiles || [];
  const nextProfiles = profiles.filter((profile) => profile.id !== profileId);
  const activeProfileId = latestStatus.settings.activeProfileId === profileId
    ? (nextProfiles[0]?.id || 'direct')
    : latestStatus.settings.activeProfileId;
  latestStatus = {
    ...latestStatus,
    activeProfile: nextProfiles.find((profile) => profile.id === activeProfileId) || latestStatus.activeProfile,
    settings: {
      ...latestStatus.settings,
      profiles: nextProfiles,
      activeProfileId
    }
  };
  renderProfiles();
}

function applyOptimisticLogsClear() {
  if (!latestStatus) return;
  latestStatus = { ...latestStatus, logs: [] };
  if (isPageActive('logs')) renderLogs();
}

function removeConnectionElement(button) {
  const row = button?.closest('.simple-row');
  if (row) row.remove();
  if (!$('#connectionRows')?.querySelector('.simple-row')) {
    $('#connectionRows').innerHTML = '<p class="empty">当前没有活动连接。</p>';
  }
}

function optimisticProfilePatch(profileId, patch) {
  if (!latestStatus?.settings) return;
  const profiles = latestStatus.settings.profiles || [];
  latestStatus = {
    ...latestStatus,
    settings: {
      ...latestStatus.settings,
      profiles: profiles.map((profile) => profile.id === profileId ? { ...profile, ...patch } : profile)
    }
  };
  renderProfiles();
}

function applyOptimisticProfilePending(profileId, label = 'syncing') {
  optimisticProfilePatch(profileId, { uiPending: true, uiPendingLabel: label });
}

function applyOptimisticProfilesPending(label = 'syncing') {
  if (!latestStatus?.settings) return;
  const profiles = latestStatus.settings.profiles || [];
  latestStatus = {
    ...latestStatus,
    settings: {
      ...latestStatus.settings,
      profiles: profiles.map((profile) => {
        if (profile.id === 'direct' || profile.profile_type === 'builtin') return profile;
        return { ...profile, uiPending: true, uiPendingLabel: label };
      })
    }
  };
  renderProfiles();
}

function applyOptimisticProfileImport(url) {
  if (!latestStatus?.settings) return '';
  const host = (() => {
    try { return new URL(url).host || url; } catch { return url || 'remote'; }
  })();
  const tempId = `pending-${Date.now()}`;
  const pendingProfile = {
    id: tempId,
    name: host,
    profile_type: 'url',
    updated_at: 'pending',
    node_count: 0,
    uiPending: true,
    uiPendingLabel: 'importing'
  };
  latestStatus = {
    ...latestStatus,
    settings: {
      ...latestStatus.settings,
      profiles: [...(latestStatus.settings.profiles || []), pendingProfile],
      activeProfileId: tempId
    },
    activeProfile: pendingProfile
  };
  renderProfiles();
  return tempId;
}

async function refreshStatus(force = false) {
  if (statusBusy) return;
  if (!force && isForegroundHot()) return;
  if (!force && (foregroundBusy > 0 || backgroundJobBusy > 0)) return;
  const now = Date.now();
  if (!force && now - lastStatusAt < 1800) return;
  lastStatusAt = now;
  statusBusy = true;
  try {
    renderStatus(await invoke('app_status'));
  } catch {
    renderStatus({
      running: false,
      appVersion: defaultAppVersion,
      mode: 'rule',
      traffic: { up: 0, down: 0 },
      logs: [],
      network: { lanIp: '-', proxyEndpoint: `127.0.0.1:${defaultMixedPort}`, outboundIp: '-' },
      permissions: { isAdmin: false, requiresAdminFor: ['TUN', 'Kill Switch'] },
      settings: {
        activeProfileId: 'direct',
        profiles: [],
        mixedPort: defaultMixedPort,
        controllerPort: defaultControllerPort,
        startWithSystemProxy: true,
        dnsHijackEnabled: true,
        tunEnabled: false,
        killSwitchEnabled: false,
        systemProxy: false,
        ipv6Enabled: false,
        allowLan: false,
        tunStack: 'mixed',
        logLevel: 'info',
        reliability: {
          auto: true,
          profileFailover: true,
          failureThreshold: 2,
          maxDelayMs: 800,
          candidateLimit: 24
        }
      },
      protection: { label: '未接管' },
      activeProfile: { name: 'Aegos 本地预览' }
    });
  } finally {
    statusBusy = false;
  }
}

async function refreshNodes(force = false) {
  if (nodeBusy) return;
  if (!force && isForegroundHot()) return;
  if (!force && (foregroundBusy > 0 || backgroundJobBusy > 0)) return;
  nodeBusy = true;
  try {
    const groups = await invoke('proxy_groups');
    latestGroup = Array.isArray(groups) ? (groups.find((group) => group.name === 'GLOBAL') || groups[0]) : null;
    selectedNode = latestGroup?.now || selectedNode;
    scheduleRowsRender(latestGroup?.items || []);
  } catch {
    latestGroup = null;
    if (isNodeSurfaceActive()) renderRows();
    else pendingRowItems = [];
  } finally {
    nodeBusy = false;
  }
}

function stopSpeedTestPolling() {
  if (speedTestTimer) clearInterval(speedTestTimer);
  speedTestTimer = null;
}

async function pollSpeedTest() {
  try {
    const status = await invoke('speed_test_status');
    const now = Date.now();
    if (!isForegroundHot() && (!status.running || now - lastSpeedNodeRefreshAt >= speedTestNodeRefreshMs)) {
      lastSpeedNodeRefreshAt = now;
      await refreshNodes(true);
    }
    if (status.running) {
      setNotice(`正在测速：${status.completed || 0}/${status.total || 0}，成功 ${status.ok || 0}，失败 ${status.failed || 0}`);
      return;
    }
    stopSpeedTestPolling();
    setNotice(`节点测速已完成：成功 ${status.ok || 0}，失败 ${status.failed || 0}，共 ${status.total || 0} 个。`);
  } catch (err) {
    stopSpeedTestPolling();
    setNotice(`读取测速进度失败：${err.message || err}`);
  }
}

async function testNodes() {
  if (speedTestTimer) return;
  try {
    const status = await invoke('start_proxy_delay_test');
    lastSpeedNodeRefreshAt = 0;
    await refreshNodes(true);
    setNotice(`测速已在后台开始：0/${status.total || 0}`);
    speedTestTimer = setInterval(pollSpeedTest, speedTestPollMs);
    await pollSpeedTest();
  } catch (err) {
    setNotice(`节点测速失败：${err.message || err}`);
  }
}

async function refreshOutboundIpJob() {
  await runBackgroundJob('refreshOutboundIp', {}, {
    pendingNotice: '正在后台查询落地 IP...',
    onSuccess: async (result) => {
      const ip = result?.ip || '-';
      $('#outboundIpState').textContent = ip;
      $('#outboundMetric').textContent = ip;
      await refreshStatus(true);
    },
    successNotice: (result) => `落地 IP 已刷新：${result?.ip || '-'}`,
    failureNotice: (err) => `刷新落地 IP 失败：${err.message || err}`
  });
}

async function refreshOutboundIp() {
  try {
    setNotice('正在通过当前代理查询落地 IP...');
    const ip = await invoke('refresh_outbound_ip');
    $('#outboundIpState').textContent = ip || '-';
    $('#outboundMetric').textContent = ip || '-';
    await refreshStatus(true);
    setNotice(`落地 IP 已刷新：${ip || '-'}`);
  } catch (err) {
    await refreshStatus(true);
    setNotice(`刷新落地 IP 失败：${err.message || err}`);
  }
}

async function recoverNetwork(showHealthyNotice = true, force = false) {
  if (recoveryBusy) return null;
  recoveryBusy = true;
  lastRecoveryAt = Date.now();
  try {
    if (showHealthyNotice) setNotice('Aegos 2.0 自愈引擎正在检查出口...');
    const result = await invoke('recover_network', { force });
    await refreshStatus(true);
    await refreshNodes(true);
    if (result?.ok && result?.action === 'none') {
      if (showHealthyNotice) setNotice('网络出口健康，无需切换。');
      return result;
    }
    if (result?.action === 'observe') {
      if (showHealthyNotice) setNotice(`自愈观察中：${result.failures || 0}/${result.threshold || 0}`);
      return result;
    }
    const recovery = result?.result || {};
    if (result?.ok && result?.profileChanged) {
      setNotice(`已切换订阅并恢复：${result.profile?.name || '-'} / ${recovery.proxy || '-'}`);
      return result;
    }
    if (result?.ok) {
      setNotice(`已自动切换到可用节点：${recovery.proxy || '-'} (${recovery.delay || '-'} ms)`);
      return result;
    }
    setNotice(`自愈失败：${result?.probe?.reason || '没有找到可用节点'}`);
    return result;
  } catch (err) {
    await refreshStatus(true);
    setNotice(`自愈失败：${err.message || err}`);
    return null;
  } finally {
    recoveryBusy = false;
  }
}

async function recoverNetworkJob(showHealthyNotice = true, force = false) {
  if (recoveryBusy) return null;
  recoveryBusy = true;
  lastRecoveryAt = Date.now();
  try {
    const result = await runBackgroundJob('recoverNetwork', { force }, {
      pendingNotice: showHealthyNotice ? 'Aegos 正在后台执行网络自愈...' : '',
      progressNotice: (job) => showHealthyNotice && job?.message ? `网络自愈：${job.message}` : '',
      failureNotice: (err) => `自愈失败：${err.message || err}`
    });
    await refreshStatus(true);
    await refreshNodes(true);
    if (!result) return null;
    if (result?.ok && result?.action === 'none') {
      if (showHealthyNotice) setNotice('网络出口健康，无需切换。');
      return result;
    }
    if (result?.action === 'observe') {
      if (showHealthyNotice) setNotice(`自愈观察中：${result.failures || 0}/${result.threshold || 0}`);
      return result;
    }
    const recovery = result?.result || {};
    if (result?.ok && result?.profileChanged) {
      setNotice(`已切换订阅并恢复：${result.profile?.name || '-'} / ${recovery.proxy || '-'}`);
      return result;
    }
    if (result?.ok) {
      setNotice(`已自动切换到可用节点：${recovery.proxy || '-'} (${recovery.delay || '-'} ms)`);
      return result;
    }
    setNotice(`自愈失败：${result?.probe?.reason || '没有找到可用节点'}`);
    return result;
  } finally {
    recoveryBusy = false;
  }
}

async function updateProfileJob(id) {
  return runBackgroundJob('updateProfile', { id }, {
    pendingNotice: '正在后台更新订阅...',
    successNotice: '订阅已更新。',
    failureNotice: (err) => `订阅更新失败：${err.message || err}`
  });
}

async function updateAllProfilesJob() {
  return runBackgroundJob('updateAllProfiles', {}, {
    pendingNotice: '正在后台更新全部订阅...',
    successNotice: (result) => `全部订阅更新完成：${result?.updated?.length || 0} 成功，${result?.failed?.length || 0} 失败`,
    failureNotice: (err) => `全部订阅更新失败：${err.message || err}`
  });
}

async function addProfileUrlJob(url) {
  return runBackgroundJob('addProfileUrl', { url }, {
    pendingNotice: '正在后台导入订阅...',
    successNotice: '订阅已导入。',
    failureNotice: (err) => `订阅导入失败：${err.message || err}`
  });
}

async function setActiveProfileJob(id) {
  return runBackgroundJob('setActiveProfile', { id }, {
    pendingNotice: '正在后台应用订阅...',
    successNotice: '订阅已切换并应用。',
    failureNotice: (err) => `订阅切换失败：${err.message || err}`
  });
}

async function removeProfileJob(id) {
  return runBackgroundJob('removeProfile', { id }, {
    pendingNotice: '正在后台删除订阅...',
    successNotice: '订阅已删除。',
    failureNotice: (err) => `删除订阅失败：${err.message || err}`
  });
}

async function updateSettingsJob(updates) {
  return runBackgroundJob('updateSettings', { updates }, {
    pendingNotice: '正在后台保存设置...',
    successNotice: '设置已保存。',
    failureNotice: (err) => `保存设置失败：${err.message || err}`
  });
}

async function repairSystemProxyJob() {
  const result = await runBackgroundJob('repairSystemProxy', {}, {
    pendingNotice: '正在后台修复系统代理接管...',
    successNotice: '系统代理已指向 Aegos。',
    failureNotice: (err) => `修复系统代理失败：${err.message || err}`,
    onSuccess: async () => {
      await refreshStatus(true);
      if (isPageActive('diagnostics')) await runDiagnostics(false).catch(() => {});
    }
  });
  if (!result) await refreshStatus(true).catch(() => {});
  return result;
}

async function corePowerJob(kind, options = {}) {
  const snapshot = snapshotUiState();
  const targetRunning = kind === 'stopCore' ? false : true;
  if (latestStatus) {
    latestStatus = { ...latestStatus, running: targetRunning };
    renderStatus(latestStatus);
  }
  const result = await runBackgroundJob(kind, {}, {
    pendingNotice: options.pendingNotice,
    progressNotice: (job) => job?.message ? `${job.label}：${job.message}` : '',
    onSuccess: async () => {
      await refreshStatus(true);
      await refreshNodes(true);
    },
    successNotice: options.successNotice,
    failureNotice: options.failureNotice
  });
  if (!result) {
    const reason = lastBackgroundJobError || '核心任务失败';
    restoreUiState(snapshot);
    await refreshStatus(true).catch(() => {});
    if (isPageActive('logs')) renderLogs();
    if (isPageActive('diagnostics')) await runDiagnostics(false).catch(() => {});
    if (options.failureNotice) setNotice(resolveMessage(options.failureNotice, new Error(reason)));
  }
  return result;
}

async function maybeAutoRecover() {
  const reliability = latestStatus?.settings?.reliability || {};
  if (isForegroundHot()) return;
  if (foregroundBusy > 0 || backgroundJobBusy > 0) return;
  if (reliability.auto === false || !latestStatus?.running || recoveryBusy) return;
  if (Date.now() - lastRecoveryAt < 60000) return;
  await recoverNetworkJob(false, false);
}

async function updateActiveProfile() {
  const id = latestStatus?.settings?.activeProfileId;
  if (!id || id === 'direct') {
    setNotice('当前没有可更新的远程订阅。');
    return;
  }
  await runOptimisticAction({
    apply: () => applyOptimisticProfilePending(id, 'updating'),
    commit: async () => {
      const result = await updateProfileJob(id);
      if (!result) throw new Error(lastBackgroundJobError || 'subscription update failed');
      return result;
    },
    refresh: async () => {
      await refreshStatus(true);
      await refreshNodes(true);
      renderProfiles();
    },
    pendingNotice: '正在更新当前订阅...',
    successNotice: '订阅已更新。',
    failureNotice: (err) => `订阅更新失败：${err.message || err}`
  });
}

async function toggleCore() {
  const button = $('#connectBtn');
  await runButtonAction(button, latestStatus?.running ? '正在断开...' : '正在连接...', async () => {
    setNotice(latestStatus?.running ? '正在断开核心...' : '正在启动核心...');
    const stopping = Boolean(latestStatus?.running);
    await corePowerJob(stopping ? 'stopCore' : 'startCore', {
      pendingNotice: stopping ? '正在后台断开核心...' : '正在后台启动核心...',
      successNotice: stopping ? '已断开连接。' : '已连接，核心正在运行。',
      failureNotice: (err) => `核心操作失败：${err.message || err}`
    });
    setNotice(latestStatus?.running ? '已连接，核心正在运行。' : '已断开连接。');
  }).catch((err) => setNotice(`操作失败：${err.message || err}`));
}

function toggleModeMenu() {
  $('#modeMenu').classList.toggle('hidden');
}

async function restartCoreJob() {
  return corePowerJob('restartCore', {
    pendingNotice: '正在后台重启核心...',
    successNotice: '核心已重启。',
    failureNotice: (err) => `重启核心失败：${err.message || err}`
  });
}

async function applyMode(mode) {
  $('#modeMenu').classList.add('hidden');
  await runOptimisticAction({
    apply: () => applyOptimisticMode(mode),
    commit: () => runBackgroundJob('setMode', { mode }, {
      pendingNotice: '正在后台切换模式...',
      failureNotice: (err) => `切换模式失败：${err.message || err}`
    }),
    refresh: () => refreshStatus(true),
    pendingNotice: '正在后台切换模式...',
    successNotice: '模式已切换。',
    failureNotice: (err) => `切换模式失败：${err.message || err}`
  });
}

async function selectNode(name) {
  if (!name) return;
  if (!latestGroup?.name || !latestStatus?.running) {
    applyOptimisticNode(name);
    setNotice(`已选择节点：${name}`);
    return;
  }
  await runOptimisticAction({
    apply: () => applyOptimisticNode(name),
    commit: () => runBackgroundJob('changeProxy', { group: latestGroup.name, proxy: name }, {
      pendingNotice: '正在后台切换节点...',
      failureNotice: (err) => `切换节点失败：${err.message || err}`
    }),
    refresh: () => refreshNodes(true),
    pendingNotice: '正在后台切换节点...',
    successNotice: `已切换节点：${name}`,
    failureNotice: (err) => `切换节点失败：${err.message || err}`
  });
}

async function selectBestProxyJob() {
  await runBackgroundJob('selectBestProxy', {}, {
    pendingNotice: '正在选择低延迟最佳节点...',
    onSuccess: async (result) => {
      const candidate = result?.candidate || {};
      if (candidate.proxy) applyOptimisticNode(candidate.proxy);
      await refreshNodes(true);
    },
    successNotice: (result) => {
      const candidate = result?.candidate || {};
      return `已切换最佳节点：${candidate.proxy || '-'} / ${candidate.delay || '-'} ms`;
    },
    failureNotice: (err) => `选择最佳节点失败：${err.message || err}`
  });
}

async function updateSetting(key, value) {
  if (value && ['tunEnabled', 'killSwitchEnabled'].includes(key) && !latestStatus?.permissions?.isAdmin) {
    await refreshStatus(true);
    setNotice('TUN 和 Kill Switch 需要管理员权限，请先在设置中以管理员身份重启 Aegos。');
    return;
  }
  await runOptimisticAction({
    apply: () => applyOptimisticSetting(key, value),
    commit: () => runBackgroundJob('updateSetting', { key, value }, {
      pendingNotice: '正在后台同步设置...',
      failureNotice: (err) => `设置同步失败：${err.message || err}`
    }),
    refresh: async () => {
      await refreshStatus(true);
      await refreshNodes(true);
    },
    pendingNotice: '设置已更新，正在后台同步...',
    successNotice: '设置已同步。',
    failureNotice: (err) => `设置失败：${err.message || err}`
  });
}

function isCurrentPageTask(token, page) {
  return token == null || (token === pageLoadToken && uiStore.state.page === page);
}

async function refreshConnections(token = null) {
  if (pageCacheState.connections.loading) return;
  pageCacheState.connections.loading = true;
  try {
    const items = await invoke('connections');
    if (!isCurrentPageTask(token, 'connections')) return;
    $('#connectionRows').innerHTML = (Array.isArray(items) ? items : []).map((item) => {
      const chains = Array.isArray(item.chains) ? item.chains.join(' › ') : '-';
      const traffic = `${formatRate(item.upload)} / ${formatRate(item.download)}`;
      const target = item.metadata?.host || item.metadata?.destinationIP || item.id || '-';
      return `<div class="simple-row"><span>${escapeHtml(target)}</span><span>${escapeHtml(item.rule || '-')}</span><span>${escapeHtml(chains)}</span><span>${traffic}</span><button data-close-connection="${escapeHtml(item.id)}">关闭</button></div>`;
    }).join('') || '<p class="empty">当前没有活动连接。</p>';
    markPageCache('connections');
  } catch (err) {
    if (!isCurrentPageTask(token, 'connections')) return;
    $('#connectionRows').innerHTML = `<p class="empty">连接管理不可用：${escapeHtml(err.message || err)}</p>`;
    markPageCache('connections');
  } finally {
    pageCacheState.connections.loading = false;
  }
}

function normalizeDiagnosticCheck(item = {}) {
  const ok = Boolean(item.ok);
  const severity = ok ? 'ok' : (item.severity || 'warning');
  return {
    name: item.name || 'Check',
    ok,
    severity,
    category: item.category || 'general',
    detail: item.detail || '-',
    hint: item.hint || '',
    actionable: Boolean(item.actionable || (!ok && item.hint))
  };
}

function diagnosticSeverityLabel(check) {
  if (check.ok) return '通过';
  if (check.severity === 'error') return '错误';
  return '警告';
}

function diagnosticSeverityRank(check) {
  if (check.severity === 'error') return 0;
  if (check.severity === 'warning') return 1;
  if (!check.ok) return 2;
  return 3;
}

function diagnosticReportText(data = latestDiagnostics) {
  if (!data) return 'Aegos diagnostics: no report';
  const checks = (data.checks || []).map(normalizeDiagnosticCheck);
  const summary = data.summary || {};
  const status = data.status || {};
  const lines = [
    `Aegos Diagnostics ${data.appVersion || defaultAppVersion}`,
    `Generated: ${data.generatedAt || '-'}`,
    `Running: ${status.running ? 'yes' : 'no'}`,
    `Mode: ${status.mode || '-'}`,
    `Active profile: ${status.activeProfile?.name || '-'}`,
    `Proxy endpoint: ${status.network?.proxyEndpoint || '-'}`,
    `Summary: ${summary.errors || 0} errors, ${summary.warnings || 0} warnings, ${summary.failed || 0} failed checks`,
    ''
  ];
  checks.forEach((check) => {
    lines.push(`[${check.severity}] ${check.name}: ${check.ok ? 'ok' : 'failed'}`);
    lines.push(`  detail: ${check.detail}`);
    if (check.hint) lines.push(`  hint: ${check.hint}`);
  });
  return lines.join('\n');
}

function renderDiagnosticSummary(data, checks) {
  const summary = data.summary || {};
  const errors = Number(summary.errors || checks.filter((item) => item.severity === 'error').length);
  const warnings = Number(summary.warnings || checks.filter((item) => item.severity === 'warning').length);
  const failed = Number(summary.failed || checks.filter((item) => !item.ok).length);
  const statusClass = errors > 0 ? 'is-bad' : warnings > 0 ? 'is-warn' : 'is-ok';
  const statusText = errors > 0 ? '需要处理' : warnings > 0 ? '需要关注' : '状态正常';
  const nextActions = Array.isArray(summary.nextActions) && summary.nextActions.length
    ? summary.nextActions
    : checks.filter((item) => item.actionable).map((item) => item.hint).filter(Boolean).slice(0, 3);
  $('#diagSummary').innerHTML = `
    <div class="diagnostic-status ${statusClass}">
      <b>${escapeHtml(statusText)}</b>
      <span>${checks.length} 项检查 / ${failed} 项异常</span>
    </div>
    <div class="diagnostic-metrics">
      <span><b>${errors}</b>错误</span>
      <span><b>${warnings}</b>警告</span>
      <span><b>${checks.length - failed}</b>通过</span>
    </div>
    <div class="diagnostic-actions">
      ${nextActions.length ? nextActions.map((action) => `<small>${escapeHtml(action)}</small>`).join('') : '<small>未发现需要立即处理的问题。</small>'}
    </div>
  `;
}

function renderDiagnosticRows(checks) {
  const sorted = [...checks].sort((a, b) => diagnosticSeverityRank(a) - diagnosticSeverityRank(b));
  $('#diagRows').innerHTML = sorted.map((item) => `
    <article class="list-card diagnostic-row severity-${escapeHtml(item.severity)}">
      <div>
        <b>${escapeHtml(item.name)}</b>
        <small>${escapeHtml(item.detail)}</small>
        ${item.hint ? `<small class="diagnostic-hint">${escapeHtml(item.hint)}</small>` : ''}
      </div>
      <span class="${item.ok ? 'ok' : item.severity === 'error' ? 'bad' : 'warn'}">${diagnosticSeverityLabel(item)}</span>
    </article>
  `).join('') || '<p class="empty">暂无诊断结果。</p>';
}

function renderCachedDiagnostics() {
  if (latestDiagnostics) {
    const checks = (latestDiagnostics.checks || []).map(normalizeDiagnosticCheck);
    renderDiagnosticSummary(latestDiagnostics, checks);
    renderDiagnosticRows(checks);
    return;
  }
  $('#diagSummary').innerHTML = `
    <div class="diagnostic-status">
      <b>\u7b49\u5f85\u8bca\u65ad</b>
      <span>\u70b9\u51fb\u8fd0\u884c\u8bca\u65ad\u540e\u67e5\u770b\u5f53\u524d\u7ed3\u679c\u3002</span>
    </div>
  `;
  $('#diagRows').innerHTML = '<p class="empty">\u5c1a\u672a\u8fd0\u884c\u8bca\u65ad\u3002</p>';
}

async function runDiagnostics(showNotice = true, token = null) {
  if (pageCacheState.diagnostics.loading) return;
  pageCacheState.diagnostics.loading = true;
  try {
    const data = await invoke('diagnostics');
    if (!isCurrentPageTask(token, 'diagnostics')) return;
    latestDiagnostics = data;
    const checks = (data.checks || []).map(normalizeDiagnosticCheck);
    renderDiagnosticSummary(data, checks);
    renderDiagnosticRows(checks);
    const errors = checks.filter((item) => item.severity === 'error').length;
    const warnings = checks.filter((item) => item.severity === 'warning').length;
    if (showNotice) setNotice(`诊断完成：${checks.filter((item) => item.ok).length} 项通过，${errors} 项错误，${warnings} 项警告`);
    markPageCache('diagnostics');
  } catch (err) {
    if (!isCurrentPageTask(token, 'diagnostics')) return;
    latestDiagnostics = null;
    $('#diagSummary').innerHTML = `
      <div class="diagnostic-status is-bad">
        <b>诊断不可用</b>
        <span>无法读取诊断结果</span>
      </div>
    `;
    $('#diagRows').innerHTML = `<p class="empty">诊断失败：${escapeHtml(err.message || err)}</p>`;
    if (showNotice) setNotice(`诊断失败：${err.message || err}`);
    markPageCache('diagnostics');
  } finally {
    pageCacheState.diagnostics.loading = false;
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
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setPage(button.dataset.page);
  });
  button.onclick = (event) => {
    if (event.detail !== 0) return;
    setPage(button.dataset.page);
  };
});

$('#connectBtn').onclick = toggleCore;
$('#refreshStatusBtn').onclick = async () => { await refreshStatus(true); await refreshNodes(true); setNotice('已同步核心状态和节点列表。'); };
$('#refreshNodesBtn').onclick = refreshNodes;
$('#modeBtn').onclick = toggleModeMenu;
$('#quickModeBtn').onclick = toggleModeMenu;
$('#quickIpBtn').onclick = (event) => runButtonAction(event.currentTarget, '刷新中...', refreshOutboundIpJob);
$('#quickTestBtn').onclick = (event) => runButtonAction(event.currentTarget, '测速中...', testNodes);
$('#smartRecoverBtn').onclick = (event) => runButtonAction(event.currentTarget, '自愈中...', () => recoverNetworkJob(true, true));
$('#quickUpdateSubBtn').onclick = (event) => runButtonAction(event.currentTarget, '更新中...', updateActiveProfile);
$('#quickProxyBtn').onclick = () => updateSetting('systemProxy', !latestStatus?.settings?.systemProxy);
$('#quickTunBtn').onclick = () => updateSetting('tunEnabled', !latestStatus?.settings?.tunEnabled);
$('#quickCopyProxyBtn').onclick = () => navigator.clipboard?.writeText(latestStatus?.network?.proxyEndpoint || `127.0.0.1:${defaultMixedPort}`);
$('#quickRestartBtn').onclick = (event) => runButtonAction(event.currentTarget, '重启中...', restartCoreJob);
$('#setBestBtn').onclick = (event) => runButtonAction(event.currentTarget, '选择中...', selectBestProxyJob);
$('#refreshConnectionsBtn').onclick = refreshConnections;
$('#closeAllConnectionsBtn').onclick = (event) => runButtonAction(event.currentTarget, '关闭中...', () => runOptimisticAction({
  apply: () => { $('#connectionRows').innerHTML = '<p class="empty">当前没有活动连接。</p>'; },
  commit: () => invoke('close_connections'),
  refresh: () => refreshConnections(),
  rollback: () => refreshConnections(),
  pendingNotice: '已清空连接列表，正在后台关闭连接...',
  successNotice: '连接已关闭。',
  failureNotice: (err) => `关闭连接失败：${err.message || err}`
}));
$('#runDiagBtn').onclick = () => runDiagnostics();
const copyDiagBtn = $('#copyDiagBtn');
if (copyDiagBtn) copyDiagBtn.onclick = (event) => runButtonAction(event.currentTarget, '复制中...', async () => {
  if (!latestDiagnostics) await runDiagnostics(false);
  const report = diagnosticReportText(latestDiagnostics);
  await navigator.clipboard?.writeText(report);
  setNotice('诊断报告已复制。');
});
$('#clearLogsBtn').onclick = () => runOptimisticAction({
  apply: () => applyOptimisticLogsClear(),
  commit: () => invoke('clear_logs'),
  refresh: () => refreshStatus(true),
  pendingNotice: '日志已清空，正在后台同步...',
  successNotice: '日志已清空。',
  failureNotice: (err) => `清空日志失败：${err.message || err}`
});
$('#restartCoreBtn').onclick = (event) => runButtonAction(event.currentTarget, '重启中...', restartCoreJob);
const batchTestBtn = $('#batchTestBtn');
if (batchTestBtn) batchTestBtn.onclick = (event) => runButtonAction(event.currentTarget, '测速中...', testNodes);
const nodeSearch = $('#nodeSearch');
if (nodeSearch) nodeSearch.oninput = () => {
  nodeSearchKeyword = nodeSearch.value.trim().toLowerCase();
  scheduleRowsRender(latestGroup?.items || []);
};
$('#savePortBtn').onclick = (event) => runButtonAction(event.currentTarget, '保存中...', async () => {
  try {
    await updateSettingsJob({
      mixedPort: Number($('#mixedPortInput').value || defaultMixedPort),
      controllerPort: Number($('#controllerPortInput').value || defaultControllerPort),
      tunStack: $('#tunStackSelect').value,
      logLevel: $('#logLevelSelect').value,
      reliabilityMaxDelayMs: Number($('#reliabilityMaxDelayInput').value || 800),
      reliabilityCandidateLimit: Number($('#reliabilityCandidateLimitInput').value || 24)
    });
    await refreshStatus(true);
    await refreshNodes(true);
    setNotice('端口和高级设置已保存。');
  } catch (err) {
    await refreshStatus(true);
    setNotice(`保存高级设置失败：${err.message || err}`);
  }
});
const elevateBtn = $('#elevateBtn');
if (elevateBtn) elevateBtn.onclick = (event) => runButtonAction(event.currentTarget, '请求中...', async () => {
  try {
    setNotice('正在请求管理员权限...');
    await invoke('relaunch_as_admin');
  } catch (err) {
    setNotice(`管理员重启失败：${err.message || err}`);
  }
});
$('#addProfileBtn').onclick = (event) => runButtonAction(event.currentTarget, '导入中...', async () => {
  const url = $('#profileUrlInput').value.trim();
  if (!url) return;
  await runOptimisticAction({
    apply: () => applyOptimisticProfileImport(url),
    commit: async () => {
      const result = await addProfileUrlJob(url);
      if (!result) throw new Error(lastBackgroundJobError || 'subscription import failed');
      return result;
    },
    refresh: async () => {
      $('#profileUrlInput').value = '';
      await refreshStatus(true);
      await refreshNodes(true);
      renderProfiles();
    },
    pendingNotice: '正在后台导入订阅...',
    successNotice: '订阅已导入。',
    failureNotice: (err) => `订阅导入失败：${err.message || err}`
  });
});
const copyEndpointBtn = $('#copyEndpointBtn');
if (copyEndpointBtn) copyEndpointBtn.onclick = () => navigator.clipboard?.writeText($('#nodeHost')?.textContent || '');
const updateAllProfilesBtn = $('#updateAllProfilesBtn');
if (updateAllProfilesBtn) updateAllProfilesBtn.onclick = (event) => runButtonAction(event.currentTarget, '更新中...', async () => {
  await runOptimisticAction({
    apply: () => applyOptimisticProfilesPending('updating'),
    commit: async () => {
      const result = await updateAllProfilesJob();
      if (!result) throw new Error(lastBackgroundJobError || 'all subscription updates failed');
      return result;
    },
    refresh: async () => {
      await refreshStatus(true);
      await refreshNodes(true);
      renderProfiles();
    },
    pendingNotice: '正在后台更新全部订阅...',
    successNotice: (result) => `全部订阅更新完成：${result?.updated?.length || 0} 成功，${result?.failed?.length || 0} 失败`,
    failureNotice: (err) => `全部订阅更新失败：${err.message || err}`
  });
});

[
  ['systemProxyToggle', 'systemProxy'],
  ['startProxyToggle', 'startWithSystemProxy'],
  ['tunHomeToggle', 'tunEnabled'],
  ['tunToggle', 'tunEnabled'],
  ['dnsToggle', 'dnsHijackEnabled'],
  ['killToggle', 'killSwitchEnabled'],
  ['ipv6Toggle', 'ipv6Enabled'],
  ['allowLanToggle', 'allowLan'],
  ['reliabilityAutoToggle', 'reliabilityAuto'],
  ['profileFailoverToggle', 'reliabilityProfileFailover']
].forEach(([id, key]) => {
  $(`#${id}`).onchange = (event) => updateSetting(key, event.target.checked);
});

$all('[data-region]').forEach((button) => {
  button.onclick = () => {
    const nextRegion = uiStore.state.homeRegionFilter === button.dataset.region ? '' : button.dataset.region;
    uiStore.set({ homeRegionFilter: nextRegion });
    scheduleRowsRender(latestGroup?.items || []);
    setNotice(nextRegion ? `已在首页筛选地区：${button.textContent.trim()}` : '已取消地区筛选。');
  };
});

$all('[data-node-filter]').forEach((button) => {
  button.onclick = () => {
    uiStore.set({ nodePageFilter: button.dataset.nodeFilter || 'all' });
    scheduleRowsRender(latestGroup?.items || []);
  };
});

$all('[data-log-filter]').forEach((button) => {
  button.onclick = () => {
    logFilter = button.dataset.logFilter || 'all';
    renderLogs();
  };
});

$all('[data-mode-option]').forEach((button) => {
  button.onclick = () => applyMode(button.dataset.modeOption);
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

$('#bestNodeList').addEventListener('click', (event) => {
  const item = event.target.closest('[data-node]');
  if (!item) return;
  selectNode(item.dataset.node);
});

$('#nodeRows').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = event.target.closest('.row[data-node]');
  if (!row) return;
  event.preventDefault();
  selectNode(row.dataset.node);
});

document.body.addEventListener('click', async (event) => {
  try {
    if (!event.target.closest('.mode-box')) {
      $('#modeMenu')?.classList.add('hidden');
    }
    const cancelJobId = event.target.closest('[data-job-cancel]')?.dataset.jobCancel;
    if (cancelJobId) {
      await requestJobCancel(cancelJobId);
      return;
    }
    const retryJobId = event.target.closest('[data-job-retry]')?.dataset.jobRetry;
    if (retryJobId) {
      await retryJob(retryJobId);
      return;
    }
    const closeButton = event.target.closest('[data-close-connection]');
    const closeId = closeButton?.dataset.closeConnection;
    if (closeId) {
      await runOptimisticAction({
        apply: () => removeConnectionElement(closeButton),
        commit: () => invoke('close_connection', { id: closeId }),
        refresh: () => refreshConnections(),
        rollback: () => refreshConnections(),
        pendingNotice: '已从列表移除连接，正在后台关闭...',
        successNotice: '连接已关闭。',
        failureNotice: (err) => `关闭连接失败：${err.message || err}`
      });
      return;
    }
    const profileSwitch = event.target.closest('[data-profile-switch]')?.dataset.profileSwitch;
    const profileRow = event.target.closest('[data-profile-row]')?.dataset.profileRow;
    const profileTarget = profileSwitch || (event.target.closest('.card-actions') ? '' : profileRow);
    if (profileTarget) {
      await runOptimisticAction({
        apply: () => applyOptimisticProfile(profileTarget),
        commit: () => setActiveProfileJob(profileTarget),
        refresh: async () => {
          await refreshStatus(true);
          await refreshNodes(true);
          renderProfiles();
        },
        pendingNotice: '已选择订阅，正在后台应用配置...',
        successNotice: '订阅已切换并应用。',
        failureNotice: (err) => `订阅切换失败：${err.message || err}`
      });
      return;
    }
    const profileUpdate = event.target.closest('[data-profile-update]')?.dataset.profileUpdate;
    if (profileUpdate) {
      await runOptimisticAction({
        apply: () => applyOptimisticProfilePending(profileUpdate, 'updating'),
        commit: async () => {
          const result = await updateProfileJob(profileUpdate);
          if (!result) throw new Error(lastBackgroundJobError || 'subscription update failed');
          return result;
        },
        refresh: async () => {
          await refreshStatus(true);
          await refreshNodes(true);
          renderProfiles();
        },
        pendingNotice: '正在更新订阅...',
        successNotice: '订阅已更新。',
        failureNotice: (err) => `订阅更新失败：${err.message || err}`
      });
      return;
    }
    const profileRemove = event.target.closest('[data-profile-remove]')?.dataset.profileRemove;
    if (profileRemove) {
      await runOptimisticAction({
        apply: () => applyOptimisticProfileRemove(profileRemove),
        commit: () => removeProfileJob(profileRemove),
        refresh: async () => {
          await refreshStatus(true);
          await refreshNodes(true);
          renderProfiles();
        },
        pendingNotice: '订阅已从列表移除，正在后台删除...',
        successNotice: '订阅已删除。',
        failureNotice: (err) => `删除订阅失败：${err.message || err}`
      });
    }
  } catch (err) {
    setNotice(`操作失败：${err.message || err}`);
  }
});

uiStore.subscribe(renderUiState);
renderUiState();
renderJobCenter();
renderRows();
wireWindowControls();
startUiFreezeWatchdog();
refreshStatus(true);
refreshNodes();
tick();
setInterval(tick, 1000);
setInterval(() => syncJobCenter(false), 2500);
setInterval(refreshStatus, 8000);
setInterval(maybeAutoRecover, 60000);
