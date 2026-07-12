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
let homeRegionFilter = 'HK';
let homeNodeMode = 'region';
let nodePageFilter = 'all';
let nodeSearchKeyword = '';
let logFilter = 'all';
let speedTestTimer = null;
let speedTestStarting = false;
let activeSpeedRunId = 0;
let profilePreviewSeq = 0;
let profileMenuAnchor = null;
let nodeTransitionTimer = null;
const speedTestButtons = new Set();
let lastSpeedNodeRefreshAt = 0;
let latestSpeedStatus = null;
let lastAppliedSpeedSignature = '';
let latestRecommendedName = '';
let outboundIpRequestSeq = 0;
let outboundIpPendingSeq = 0;
let outboundIpLastStable = '-';
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
let activeConnectionCount = 0;
let activeConnectionBusy = false;
let lastActiveConnectionAt = 0;
const jobRecords = new Map();
const terminalJobStates = new Set(['succeeded', 'failed', 'cancelled']);
const recentInvokes = [];

const uiStore = {
  state: {
    page: 'home',
    homeNodeMode: 'region',
    homeRegionFilter: 'HK',
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
  if (text.includes('anytls')) return 'AnyTLS';
  if (text.includes('hysteria')) return 'Hysteria';
  if (text === 'hy2') return 'Hysteria';
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
const speedTestPollMs = 180;
const speedTestNodeRefreshMs = 1200;
const largeNodeScanLimit = 180;
const eagerNodeIndexLimit = 900;
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
let nodeRowStaticCache = new Map();
let nodeItemIndex = new Map();
let renderedPage = '';
let renderedHomeRegionFilter = null;
let renderedHomeNodeMode = null;
let renderedNodePageFilter = null;
let lastNavAt = 0;
const pageCacheState = {
  connections: { loaded: false, loading: false, updatedAt: 0 },
  diagnostics: { loaded: false, loading: false, updatedAt: 0 },
  profiles: { loaded: false, loading: false, updatedAt: 0 },
  logs: { loaded: false, loading: false, updatedAt: 0 }
};

function readLocalJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || '') ?? fallback;
  } catch {
    return fallback;
  }
}

let favoriteNodes = new Set(readLocalJson('aegos.favoriteNodes', []));
let nodeUsageCounts = new Map(Object.entries(readLocalJson('aegos.nodeUsageCounts', {})));

function saveFavoriteNodes() {
  localStorage.setItem('aegos.favoriteNodes', JSON.stringify([...favoriteNodes]));
}

function saveNodeUsageCounts() {
  localStorage.setItem('aegos.nodeUsageCounts', JSON.stringify(Object.fromEntries(nodeUsageCounts)));
}

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

function text(value = '') {
  return document.createTextNode(String(value ?? ''));
}

function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.id) node.id = options.id;
  if (options.textContent != null) node.textContent = String(options.textContent);
  if (options.dataset) {
    Object.entries(options.dataset).forEach(([key, value]) => {
      if (value != null) node.dataset[key] = String(value);
    });
  }
  if (options.attrs) {
    Object.entries(options.attrs).forEach(([key, value]) => {
      if (value === false || value == null) return;
      node.setAttribute(key, value === true ? '' : String(value));
    });
  }
  if (options.disabled) node.disabled = true;
  if (options.ariaLabel) node.setAttribute('aria-label', String(options.ariaLabel));
  children.flat().forEach((child) => {
    if (child == null) return;
    node.append(child instanceof Node ? child : text(child));
  });
  return node;
}

function icon(className) {
  return el('span', {
    className: `aegos-icon ${className}`,
    attrs: { 'aria-hidden': 'true' }
  });
}

function emptyState(message) {
  return el('p', { className: 'empty', textContent: message });
}

function replaceChildrenSafe(target, children = []) {
  if (!target) return;
  target.replaceChildren(...children.filter(Boolean));
}

function indexNodeItem(item, index) {
  const name = item?.name || '';
  const realName = item?.realProxyName || '';
  if (name) nodeItemIndex.set(name, index);
  if (realName) nodeItemIndex.set(realName, index);
}

function rebuildNodeItemIndex(items = [], currentName = '') {
  nodeItemIndex = new Map();
  const eagerLimit = Math.min(items.length, eagerNodeIndexLimit);
  for (let index = 0; index < eagerLimit; index += 1) indexNodeItem(items[index], index);
  if (currentName && !nodeItemIndex.has(currentName)) {
    const currentIndex = items.findIndex((item) => item?.name === currentName || item?.realProxyName === currentName);
    if (currentIndex >= 0) indexNodeItem(items[currentIndex], currentIndex);
  }
}

function setLatestGroup(group) {
  latestGroup = group || null;
  rebuildNodeItemIndex(latestGroup?.items || [], selectedNode || latestGroup?.now || '');
}

function nodeIndexForName(name) {
  if (!name) return null;
  if (nodeItemIndex.has(name)) return nodeItemIndex.get(name);
  const items = latestGroup?.items || [];
  const index = items.findIndex((item) => item?.name === name || item?.realProxyName === name);
  if (index >= 0) {
    indexNodeItem(items[index], index);
    return index;
  }
  return null;
}

function formatClock() {
  const total = latestStatus?.trafficTakeover ? Math.floor((Date.now() - startedAt) / 1000) : 0;
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
        const healthConfidence = item.healthConfidence || item.confidence || (delay === 0 ? 'testing' : delay > 0 ? 'stale' : 'unknown');
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
          Number(item.failureStreak ?? 0),
          favoriteNodes.has(item.name),
          isFixedNodeItem(item),
          Number(nodeUsageCounts.get(item.name) || 0),
          healthConfidence,
          Number(item.lastTestedAt ?? 0),
          item.lastFailureReason || item.last_failure_reason || ''
        ];
      })
    : fallbackNodes.map((row, index) => [...row, -1, true, index === 0, 'direct', 'unknown', -1, 0, 999999, false, 0, false, false, index === 0 ? 1 : 0, 'unknown', 0, '']);
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
  if (filter === 'favorite') return rows.filter((row) => row[13]);
  if (filter === 'recent') return rows.filter((row) => row[15] > 0 || row[5]);
  return rows;
}

function isNodeSurfaceActive(page = uiStore.state.page) {
  return page === 'home' || page === 'nodes';
}

function activeNodeRenderTarget(page = uiStore.state.page) {
  return page === 'nodes' ? 'nodes' : 'home';
}

function queueNodeRefresh(target = activeNodeRenderTarget(), delay = 0) {
  const run = () => {
    if (nodeBusy) {
      setTimeout(run, 120);
      return;
    }
    refreshNodes(true, { target }).then(() => {
      if (latestSpeedStatus) applySpeedStatusToNodes(latestSpeedStatus, { force: true });
    }).catch(() => {});
  };
  if (delay > 0) setTimeout(run, delay);
  else run();
}

async function refreshVisibleNodesForSpeed(finalRefresh = false) {
  let changed = false;
  if (latestSpeedStatus) {
    changed = applySpeedStatusToNodes(latestSpeedStatus);
  }
  const now = Date.now();
  if (!finalRefresh && now - lastSpeedNodeRefreshAt < speedTestNodeRefreshMs) return;
  lastSpeedNodeRefreshAt = now;
  if (finalRefresh && changed) queueNodeRefresh('all', 900);
}

function isSpeedTestActive() {
  return Boolean(speedTestTimer || speedTestStarting);
}

function speedHealthValue(health = {}, camelKey, snakeKey = camelKey) {
  return health?.[camelKey] ?? health?.[snakeKey];
}

function applySpeedStatusToNodes(status = {}, options = {}) {
  latestSpeedStatus = status || latestSpeedStatus;
  if (!latestGroup?.items?.length || !status) return false;
  const delays = status.delays || {};
  const health = status.health || {};
  const delayKeys = Object.keys(delays);
  const healthKeys = Object.keys(health);
  const recommendedName = status.recommended?.realProxyName || status.recommended?.proxy || status.recommended?.name || '';
  const signature = [
    status.running ? '1' : '0',
    status.completed || 0,
    status.ok || 0,
    status.failed || 0,
    status.updatedAt || 0,
    delayKeys.length,
    healthKeys.length,
    recommendedName
  ].join(':');
  if (!options.force && signature === lastAppliedSpeedSignature) return false;
  lastAppliedSpeedSignature = signature;
  if (!delayKeys.length && !healthKeys.length && !recommendedName) return false;

  let changed = false;
  const items = latestGroup.items;
  let nextItems = items;
  const touched = new Set([...delayKeys, ...healthKeys]);
  if (recommendedName) touched.add(recommendedName);
  if (latestRecommendedName) touched.add(latestRecommendedName);

  touched.forEach((key) => {
    const index = nodeIndexForName(key);
    if (index == null || !items[index]) return;
    const item = items[index];
    const name = item.realProxyName || item.name;
    const itemHealth = health[name] || health[item.name] || health[key] || {};
    const hasDelay = Object.prototype.hasOwnProperty.call(delays, name)
      || Object.prototype.hasOwnProperty.call(delays, item.name)
      || Object.prototype.hasOwnProperty.call(delays, key);
    const rawDelay = hasDelay ? (delays[name] ?? delays[item.name] ?? delays[key]) : speedHealthValue(itemHealth, 'lastDelay', 'last_delay');
    const isRecommended = recommendedName ? recommendedName === name || recommendedName === item.name : Boolean(item.recommended);
    if (rawDelay == null && !Object.keys(itemHealth).length && isRecommended === Boolean(item.recommended)) return;
    const nextDelay = rawDelay != null ? Number(rawDelay) : Number(item.delay ?? -1);
    const lastTestedAt = Number(speedHealthValue(itemHealth, 'lastTestedAt', 'last_tested_at') ?? item.lastTestedAt ?? 0);
    const next = {
      ...item,
      delay: nextDelay,
      alive: nextDelay >= 0 || item.alive !== false,
      healthStatus: speedHealthValue(itemHealth, 'status') || (nextDelay === 0 ? 'testing' : nextDelay > 0 && nextDelay < 100 ? 'low' : nextDelay > 0 ? 'available' : item.healthStatus),
      healthConfidence: speedHealthValue(itemHealth, 'confidence') || item.healthConfidence || (nextDelay === 0 ? 'testing' : nextDelay > 0 ? 'medium' : item.healthConfidence),
      medianDelay: Number(speedHealthValue(itemHealth, 'medianDelay', 'median_delay') ?? item.medianDelay ?? nextDelay),
      jitter: Number(speedHealthValue(itemHealth, 'jitter') ?? item.jitter ?? 0),
      healthScore: Number(speedHealthValue(itemHealth, 'score') ?? item.healthScore ?? (nextDelay > 0 ? nextDelay : 999999)),
      failureStreak: Number(speedHealthValue(itemHealth, 'failureStreak', 'failure_streak') ?? item.failureStreak ?? 0),
      lastFailureReason: speedHealthValue(itemHealth, 'lastFailureReason', 'last_failure_reason') || item.lastFailureReason || item.last_failure_reason || '',
      lastTestedAt,
      recommended: isRecommended
    };
    const itemChanged = next.delay !== item.delay
      || next.healthStatus !== item.healthStatus
      || next.healthConfidence !== item.healthConfidence
      || next.failureStreak !== item.failureStreak
      || next.lastFailureReason !== (item.lastFailureReason || item.last_failure_reason || '')
      || next.lastTestedAt !== item.lastTestedAt
      || next.recommended !== item.recommended;
    if (!itemChanged) return;
    if (nextItems === items) nextItems = items.slice();
    nextItems[index] = next;
    changed = true;
  });
  if (recommendedName) latestRecommendedName = recommendedName;
  if (changed) setLatestGroup({ ...latestGroup, items: nextItems });
  if (changed || options.force) {
    scheduleRowsRender(latestGroup.items, { force: true, target: 'all', delay: 0 });
    renderHomeNodeSummary(summaryRowsFromLatestGroup());
  }
  return changed;
}

function normalizeNodeItem(item = {}, index = 0) {
  const delay = Number(item.delay ?? -1);
  const healthStatus = item.healthStatus || (delay === 0 ? 'testing' : delay > 0 ? 'available' : 'unknown');
  const healthConfidence = item.healthConfidence || item.confidence || (delay === 0 ? 'testing' : delay > 0 ? 'stale' : 'unknown');
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
    Number(item.failureStreak ?? 0),
    favoriteNodes.has(name),
    isFixedNodeItem(item),
    Number(nodeUsageCounts.get(name) || 0),
    healthConfidence,
    Number(item.lastTestedAt ?? 0),
    item.lastFailureReason || item.last_failure_reason || ''
  ];
}

function normalizeNodeItemCached(item = {}, index = 0) {
  const name = item.name || `Node ${index + 1}`;
  const host = item.server || name;
  const protocol = item.type || item.protocol || 'unknown';
  const cacheKey = `${name}\u0000${host}\u0000${protocol}\u0000${item.source || ''}\u0000${item.profileType || ''}`;
  let cached = nodeRowStaticCache.get(cacheKey);
  if (!cached) {
    cached = {
      region: inferRegion(name),
      name,
      host,
      protocol,
      fixed: isFixedNodeItem(item)
    };
    if (nodeRowStaticCache.size > 20000) nodeRowStaticCache = new Map();
    nodeRowStaticCache.set(cacheKey, cached);
  }
  const delay = Number(item.delay ?? -1);
  const healthStatus = item.healthStatus || (delay === 0 ? 'testing' : delay > 0 ? 'available' : 'unknown');
  const healthConfidence = item.healthConfidence || item.confidence || (delay === 0 ? 'testing' : delay > 0 ? 'stale' : 'unknown');
  const score = Number(item.healthScore ?? (delay > 0 ? delay : 999999));
  return [
    cached.region,
    cached.name,
    cached.host,
    delay,
    item.alive !== false || delay === 0,
    cached.name === selectedNode || cached.name === latestGroup?.now,
    cached.protocol,
    healthStatus,
    Number(item.medianDelay ?? delay),
    Number(item.jitter ?? 0),
    score,
    Boolean(item.recommended),
    Number(item.failureStreak ?? 0),
    favoriteNodes.has(cached.name),
    cached.fixed,
    Number(nodeUsageCounts.get(cached.name) || 0),
    healthConfidence,
    Number(item.lastTestedAt ?? 0),
    item.lastFailureReason || item.last_failure_reason || ''
  ];
}

function isProxyGroupReferenceItem(item = {}) {
  const type = String(item.type || item.protocol || '').toLowerCase();
  return Boolean(item.group || item.isGroup || type === 'group');
}

function isFixedNodeItem(item = {}) {
  const text = `${item.name || ''} ${item.server || ''} ${item.source || ''} ${item.profileType || ''} ${item.type || ''}`.toLowerCase();
  return Boolean(item.manual || item.fixed || item.static || item.residential || /固定|住宅|静态|自建|manual|fixed|static|residential/.test(text));
}

function rowMatchesNodeFilter(row, filter) {
  if (filter === 'low') {
    const delay = Number(row[3]);
    return row[4] && row[7] !== 'cooldown' && delay > 0 && delay < 100;
  }
  if (filter === 'asia') return ['HK', 'JP', 'SG', 'TW'].includes(row[0]);
  if (filter === 'europe') return row[0] === 'GB';
  if (filter === 'north-america') return row[0] === 'US';
  if (filter === 'favorite') return row[13];
  if (filter === 'recent') return row[15] > 0 || row[5];
  return true;
}

function rowMatchesHomeFilter(row) {
  if (homeNodeMode === 'favorite') return row[13];
  if (homeNodeMode === 'fixed') return row[14];
  if (homeNodeMode === 'region') return !homeRegionFilter || row[0] === homeRegionFilter;
  return true;
}

function itemMatchesNodeSearch(item = {}, keyword = nodeSearchKeyword) {
  if (!keyword) return true;
  return `${item.name || ''} ${item.server || ''}`.toLowerCase().includes(keyword);
}

function compareBestRows(a, b) {
  return Number(b[11]) - Number(a[11]) || Number(a[10]) - Number(b[10]) || Number(a[3]) - Number(b[3]);
}

function compareHomeRows(a, b) {
  const delayA = Number(a[3]) > 0 ? Number(a[3]) : 999999;
  const delayB = Number(b[3]) > 0 ? Number(b[3]) : 999999;
  return Number(b[15]) - Number(a[15])
    || Number(b[11]) - Number(a[11])
    || delayA - delayB
    || Number(a[10]) - Number(b[10])
    || String(a[1] || '').localeCompare(String(b[1] || ''));
}

function rememberRankedRow(rows, row, compare, limit) {
  rows.push(row);
  rows.sort(compare);
  if (rows.length > limit) rows.length = limit;
}

function rememberBestRow(bestRows, row) {
  const delay = Number(row[3]);
  if (!row[4] || row[7] === 'cooldown' || delay <= 0 || delay >= 100) return;
  rememberRankedRow(bestRows, row, compareBestRows, 3);
}

function delayClass(value) {
  const delay = Number(value);
  if (delay > 0 && delay < 100) return 'delay-good';
  if (delay >= 100) return 'delay-bad';
  if (delay === 0) return 'delay-testing';
  return 'delay-muted';
}

function delayText(value) {
  const delay = Number(value);
  if (delay > 0) return `${Math.round(delay)} ms`;
  if (delay === 0) return '\u6d4b\u901f\u4e2d';
  return '-';
}

function shortAddress(host = '') {
  const value = String(host || '').trim();
  if (!value) return '-';
  if (value.length <= 24) return value;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return value;
  const parts = value.split('.');
  if (parts.length >= 2) {
    const suffix = parts.slice(-2).join('.');
    const prefix = parts[0].slice(0, 6);
    return `${prefix}\u2026${suffix}`;
  }
  return `${value.slice(0, 10)}\u2026${value.slice(-8)}`;
}

function nodeAddressInfo(row = []) {
  const protocol = protocolLabel(row?.[6] || 'unknown');
  const host = String(row?.[2] || '').trim();
  return {
    label: `${protocol} / ${shortAddress(host)}`,
    title: `${protocol} / ${host || '-'}`
  };
}

function speedFailureReasonLabel(reason = '') {
  const key = String(reason || '').toLowerCase();
  if (!key) return '测速失败';
  if (key.includes('fake-ip') || key.includes('fake ip')) return 'DNS 污染';
  if (key.includes('protection') || key.includes('firewall') || key.includes('kill')) return '保护拦截';
  if (key.includes('node-not-found')) return '节点缺失';
  if (key.includes('node-connect')) return '节点不通';
  if (key.includes('controller-delay')) return '核心测速失败';
  if (key.includes('probe-failed')) return '探测失败';
  if (key.includes('timeout')) return '超时';
  if (key.includes('dns')) return 'DNS 失败';
  if (key.includes('tls')) return 'TLS 失败';
  if (key.includes('auth')) return '认证失败';
  if (key.includes('controller')) return '核心未响应';
  if (key.includes('unsupported')) return '协议不支持';
  if (key.includes('config')) return '配置错误';
  if (key.includes('network')) return '连接失败';
  return '测速失败';
}

function nodeDelayText(row) {
  const delay = Number(row?.[3] ?? -1);
  if (delay > 0) return `${Math.round(delay)} ms`;
  if (delay === 0) return '\u6d4b\u901f\u4e2d';
  return '-';
}

function nodeSpeedNoteInfo(row) {
  const delay = Number(row?.[3] ?? -1);
  const failureReason = String(row?.[18] || '');
  const hasFailed = Number(row?.[17] || 0) > 0 || Number(row?.[12] || 0) > 0 || Boolean(failureReason);
  if (delay === 0) {
    return { label: '\u6d4b\u901f\u4e2d', className: 'node-note note-testing', title: '\u8282\u70b9\u6b63\u5728\u6d4b\u901f' };
  }
  if (delay > 0 && delay < 100) {
    return { label: '\u6b63\u5e38', className: 'node-note note-ok', title: '\u672c\u6b21\u6d4b\u901f\u6210\u529f' };
  }
  if (delay >= 100) {
    return { label: '\u504f\u9ad8', className: 'node-note note-warn', title: '\u5ef6\u8fdf\u9ad8\u4e8e 100 ms' };
  }
  if (hasFailed) {
    const label = speedFailureReasonLabel(failureReason);
    return { label, className: 'node-note note-bad', title: failureReason || label };
  }
  return { label: '\u5f85\u6d4b', className: 'node-note note-muted', title: '\u5c1a\u672a\u6d4b\u901f' };
}

function confidenceLabel(value) {
  const labels = {
    high: '\u9ad8',
    medium: '\u4e2d',
    low: '\u4f4e',
    stale: '\u8fc7\u671f',
    failed: '\u5931\u8d25',
    cooldown: '\u51b7\u5374',
    testing: '\u6d4b\u901f\u4e2d',
    unknown: '-'
  };
  return labels[String(value || 'unknown')] || labels.unknown;
}

function confidenceClass(value) {
  const key = String(value || 'unknown');
  if (key === 'high' || key === 'medium') return 'confidence-good';
  if (key === 'low' || key === 'stale' || key === 'cooldown') return 'confidence-warn';
  if (key === 'failed') return 'confidence-bad';
  return 'confidence-muted';
}

function averageAvailableDelay(rows = []) {
  const delays = rows.map((row) => Number(row?.[3] || -1)).filter((delay) => delay > 0);
  if (!delays.length) return 0;
  return delays.reduce((sum, delay) => sum + delay, 0) / delays.length;
}

function stabilityInfo(row, rows = []) {
  if (!row) return { label: '\u672a\u6d4b\u901f', level: 'unknown', className: 'confidence-muted', metricClassName: 'metric-stability-muted' };
  const delay = Number(row[3] || -1);
  const healthStatus = String(row[7] || 'unknown');
  const medianDelay = Number(row[8] || delay);
  const jitter = Number(row[9] || 0);
  const failureStreak = Number(row[12] || 0);
  const confidence = String(row[16] || 'unknown');
  const failureReason = String(row[18] || '');
  if (delay === 0 || healthStatus === 'testing' || confidence === 'testing') {
    return { label: '\u6d4b\u901f\u4e2d', level: 'testing', className: 'confidence-muted', metricClassName: 'metric-stability-muted' };
  }
  if (delay <= 0 && (failureStreak > 0 || Number(row[17] || 0) > 0)) {
    return { label: speedFailureReasonLabel(failureReason), level: 'failed', className: 'confidence-bad', metricClassName: 'metric-stability-low' };
  }
  if (delay <= 0 || healthStatus === 'unknown') {
    return { label: '\u672a\u6d4b\u901f', level: 'unknown', className: 'confidence-muted', metricClassName: 'metric-stability-muted' };
  }
  if (failureStreak >= 2 || healthStatus === 'cooldown' || confidence === 'failed') {
    return { label: '\u4f4e', level: 'low', className: 'confidence-bad', metricClassName: 'metric-stability-low' };
  }
  const baseline = averageAvailableDelay(rows);
  const relative = baseline > 0 ? delay / baseline : 1;
  const jitterRatio = delay > 0 ? jitter / delay : 1;
  const confidenceOk = confidence === 'high' || confidence === 'medium';
  if (confidenceOk && failureStreak === 0 && delay < 100 && relative <= 0.95 && jitterRatio <= 0.45 && medianDelay <= delay * 1.25) {
    return { label: '\u9ad8', level: 'high', className: 'confidence-good', metricClassName: 'metric-stability-high' };
  }
  if (failureStreak <= 1 && relative <= 1.35 && jitterRatio <= 0.85 && delay < 220) {
    return { label: '\u4e2d', level: 'medium', className: 'confidence-warn', metricClassName: 'metric-stability-medium' };
  }
  return { label: '\u4f4e', level: 'low', className: 'confidence-bad', metricClassName: 'metric-stability-low' };
}

function lastTestedText(row) {
  const testedAt = Number(row?.[17] || 0);
  if (!testedAt) return '\u672a\u6d4b\u901f';
  const age = Math.max(0, Math.floor(Date.now() / 1000) - testedAt);
  if (age < 90) return '\u521a\u521a';
  if (age < 3600) return `${Math.max(1, Math.round(age / 60))}\u5206\u949f\u524d`;
  return `${Math.max(1, Math.round(age / 3600))}\u5c0f\u65f6\u524d`;
}

function normalizedGroupType(value = '') {
  return String(value || '').replace(/[\s_-]/g, '').toLowerCase();
}

function isAutoStrategyGroup(group = latestGroup) {
  return ['urltest', 'fallback', 'loadbalance'].includes(normalizedGroupType(group?.type));
}

function findRowByName(name, rows = []) {
  if (!name) return null;
  return rows.find((row) => row?.[1] === name) || null;
}

function currentNodeRow(rows = []) {
  const currentName = selectedNode || latestGroup?.now || '';
  return findRowByName(currentName, rows) || rows.find((row) => row?.[5]) || null;
}

function summaryRowsFromLatestGroup(limit = 600) {
  const items = latestGroup?.items || [];
  if (!items.length) return [];
  const currentName = selectedNode || latestGroup?.now || '';
  const rows = [];
  let currentRow = null;
  const sampleLimit = Math.min(items.length, limit);
  for (let index = 0; index < sampleLimit; index += 1) {
    const row = normalizeNodeItemCached(items[index], index);
    if (row[1] === currentName || row[5]) currentRow = row;
    rows.push(row);
  }
  if (currentName && !currentRow) {
    const currentIndex = items.findIndex((item) => item.name === currentName || item.realProxyName === currentName);
    if (currentIndex >= 0) {
      currentRow = normalizeNodeItemCached(items[currentIndex], currentIndex);
      rows.unshift(currentRow);
    }
  }
  return rows;
}

function renderHomeNodeSummary(rows = []) {
  const sourceRows = rows.length
    ? rows
    : summaryRowsFromLatestGroup();
  const currentRow = currentNodeRow(sourceRows);
  const currentDelay = nodeDelayText(currentRow);
  const currentDelayClass = delayClass(currentRow?.[3]);
  const stability = stabilityInfo(currentRow, sourceRows);

  const delayMetric = $('#delayMetric');
  if (delayMetric) {
    delayMetric.textContent = currentDelay;
    delayMetric.className = currentDelayClass;
  }
  const stabilityMetric = $('#stabilityMetric');
  if (stabilityMetric) {
    stabilityMetric.textContent = stability.label;
    stabilityMetric.className = stability.metricClassName;
  }
  const lastTestedMetric = $('#lastTestedMetric');
  if (lastTestedMetric) lastTestedMetric.textContent = lastTestedText(currentRow);

  const autoGroup = isAutoStrategyGroup(latestGroup);
  const notice = $('#autoGroupNotice');
  if (notice) notice.classList.toggle('hidden', !autoGroup);
}

function renderNodeRow(row) {
  const [region, name, host, delay, alive, active, protocol, healthStatus, medianDelay, jitter, score, recommended, failureStreak, favorite] = row;
  const delayValue = Number(delay);
  const delayText = nodeDelayText(row);
  const delayState = delayClass(delayValue);
  const address = nodeAddressInfo(row);
  const note = nodeSpeedNoteInfo(row);
  const title = el('strong', {}, [
    el('span', { className: 'node-badge', textContent: region }),
    text(name)
  ]);
  const actions = el('span', { className: 'row-actions' }, [
    el('button', { dataset: { nodeAction: 'test', node: name }, ariaLabel: 'test delay' }, [icon('icon-speed')]),
    el('button', { dataset: { nodeAction: 'edit', node: name }, ariaLabel: 'edit node' }, [icon('icon-edit')]),
    el('button', { dataset: { nodeAction: 'favorite', node: name }, ariaLabel: 'favorite node' }, [icon(favorite ? 'icon-star-filled' : 'icon-star')])
  ]);
  return el('div', {
    className: `row ${active ? 'selected' : ''}`,
    dataset: { node: name },
    attrs: { tabindex: '0', role: 'button' },
    ariaLabel: `select ${name}`
  }, [
    el('span', { className: 'radio' }),
    icon(`star ${favorite ? 'icon-star-filled' : 'icon-star'}`),
    title,
    el('span', { className: 'node-address', textContent: address.label, attrs: { title: address.title } }),
    el('span', { className: `node-delay ${delayState}`, textContent: delayText }),
    el('span', { className: note.className, textContent: note.label, attrs: { title: note.title } }),
    actions
  ]);
}

function renderHomeNodeRow(row) {
  const [region, name, host, delay, alive, active, protocol, healthStatus, medianDelay, jitter, score, recommended, failureStreak, favorite] = row;
  const delayValue = Number(delay);
  const delayText = nodeDelayText(row);
  const delayState = delayClass(delayValue);
  const address = nodeAddressInfo(row);
  const note = nodeSpeedNoteInfo(row);
  const title = el('strong', {}, [
    el('span', { className: 'node-badge', textContent: region }),
    text(name)
  ]);
  return el('div', {
    className: `row home-row ${active ? 'selected' : ''}`,
    dataset: { node: name },
    attrs: { tabindex: '0', role: 'button' },
    ariaLabel: `select ${name}`
  }, [
    el('span', { className: 'radio' }),
    el('span', { className: 'star', textContent: favorite ? '\u2605' : '\u2606' }),
    title,
    el('span', { className: 'node-address', textContent: address.label, attrs: { title: address.title } }),
    el('span', { className: `node-delay ${delayState}`, textContent: delayText }),
    el('span', { className: note.className, textContent: note.label, attrs: { title: note.title } })
  ]);
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

function isIconOnlyBusyButton(button) {
  if (!button) return false;
  if (button.matches('.metric-refresh, .row-actions button')) return true;
  return Boolean(button.querySelector('.aegos-icon')) && !button.textContent.trim();
}

function setButtonBusy(button, busy, label, options = {}) {
  if (!button) return;
  if (!button.dataset.idleText) button.dataset.idleText = button.textContent;
  const preserveContent = Boolean(options.preserveContent || isIconOnlyBusyButton(button));
  button.classList.toggle('busy', busy);
  button.classList.toggle('is-pending', busy);
  button.setAttribute('aria-busy', busy ? 'true' : 'false');
  button.dataset.busy = busy ? 'true' : '';
  if (preserveContent) {
    button.dataset.busyLabel = busy ? label : '';
  } else {
    button.textContent = busy ? label : button.dataset.idleText;
  }
}

async function runButtonAction(button, busyLabel, action, options = {}) {
  if (button?.dataset.busy === 'true') return null;
  setButtonBusy(button, true, busyLabel, options);
  try {
    return await runForegroundAction(action);
  } finally {
    setButtonBusy(button, false, '', options);
  }
}

async function runLocalButtonAction(button, busyLabel, action, options = {}) {
  if (button?.dataset.busy === 'true') return null;
  setButtonBusy(button, true, busyLabel, options);
  try {
    return await action();
  } finally {
    setButtonBusy(button, false, '', options);
  }
}

function runDetachedButtonAction(button, busyLabel, action, options = {}) {
  if (button?.dataset.busy === 'true') return null;
  setButtonBusy(button, true, busyLabel, options);
  Promise.resolve()
    .then(action)
    .catch((err) => setNotice(`操作异常：${err.message || err}`))
    .finally(() => setButtonBusy(button, false, '', options));
  return null;
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
    replaceChildrenSafe(box, [emptyState('\u6682\u65e0\u540e\u53f0\u4efb\u52a1')]);
    return;
  }
  replaceChildrenSafe(box, jobs.map((job) => {
    const state = terminalJobStates.has(job.state) ? job.state : 'running';
    const action = state === 'running'
      ? el('button', { dataset: { jobCancel: job.id }, textContent: '\u53d6\u6d88' })
      : state !== 'succeeded'
        ? el('button', { dataset: { jobRetry: job.id }, textContent: '\u91cd\u8bd5' })
        : null;
    return el('article', { className: `job-row ${state}` }, [
      el('div', {}, [
        el('b', { textContent: job.label }),
        el('small', { textContent: job.message || job.kind || '-' })
      ]),
      el('span', { textContent: jobProgressText(job) }),
      action
    ]);
  }));
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
    homeNodeMode,
    homeRegionFilter,
    nodePageFilter
  };
}

function restoreUiState(snapshot) {
  profilePreviewSeq += 1;
  latestStatus = cloneUiValue(snapshot.latestStatus);
  setLatestGroup(cloneUiValue(snapshot.latestGroup));
  selectedNode = snapshot.selectedNode || '';
  uiStore.set(snapshot.uiState || {
    page: uiStore.state.page,
    homeNodeMode: snapshot.homeNodeMode || 'region',
    homeRegionFilter: snapshot.homeRegionFilter || 'HK',
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
  homeNodeMode = state.homeNodeMode || 'region';
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
  if (renderedHomeRegionFilter !== homeRegionFilter) {
    $all('[data-region]').forEach((button) => button.classList.toggle('active', button.dataset.region === homeRegionFilter));
    renderedHomeRegionFilter = homeRegionFilter;
  }
  if (renderedHomeNodeMode !== homeNodeMode) {
    $all('[data-home-mode]').forEach((button) => button.classList.toggle('active', button.dataset.homeMode === homeNodeMode));
    $('#homeRegionRow')?.classList.toggle('hidden', homeNodeMode !== 'region');
    renderedHomeNodeMode = homeNodeMode;
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
let pendingRowTarget = null;
let pendingRowTransition = false;
const rowRenderSettleMs = 320;

function setNodeListTransition(active) {
  ['#homeNodeRows', '#nodeRows'].forEach((selector) => {
    const element = $(selector);
    if (element) element.classList.toggle('node-list-transitioning', Boolean(active));
  });
}

function beginNodeListTransition() {
  if (nodeTransitionTimer) clearTimeout(nodeTransitionTimer);
  setNodeListTransition(true);
}

function finishNodeListTransition() {
  if (nodeTransitionTimer) clearTimeout(nodeTransitionTimer);
  nodeTransitionTimer = setTimeout(() => {
    setNodeListTransition(false);
    nodeTransitionTimer = null;
  }, 90);
}

function scheduleRowsRender(items = latestGroup?.items || [], options = {}) {
  pendingRowItems = items;
  const nextTarget = options.target || 'all';
  pendingRowTarget = pendingRowTarget && pendingRowTarget !== nextTarget ? 'all' : nextTarget;
  pendingRowTransition = Boolean(pendingRowTransition || options.transition);
  if (!options.force && !isNodeSurfaceActive()) return;
  if (rowRenderFrame) clearTimeout(rowRenderFrame);
  const run = () => {
    rowRenderFrame = null;
    const nextItems = pendingRowItems || [];
    const target = pendingRowTarget || 'all';
    const transition = pendingRowTransition;
    pendingRowItems = null;
    pendingRowTarget = null;
    pendingRowTransition = false;
    renderRows(nextItems, { target, transition });
  };
  rowRenderFrame = setTimeout(run, options.delay ?? rowRenderSettleMs);
}

function renderRows(items = [], options = {}) {
  const target = options.target || 'all';
  const shouldRenderNodeRows = target !== 'home';
  const shouldRenderHomeRows = target !== 'nodes';
  const sourceItems = items.length
    ? items
    : fallbackNodes.map(([region, name, server]) => ({ name, server, type: 'direct', region, delay: -1, alive: true }));
  const bestRows = [];
  const fallbackBestRows = [];
  const nodeRows = [];
  const homeRows = [];
  const stabilityRows = [];
  let activeRow = null;
  let matchingNodeCount = 0;
  const largeList = sourceItems.length > 1500;

  for (let index = 0; index < sourceItems.length; index += 1) {
    const item = sourceItems[index];
    if (isProxyGroupReferenceItem(item)) continue;
    const row = normalizeNodeItemCached(item, index);
    if (Number(row[3]) > 0) stabilityRows.push(row);
    rememberBestRow(bestRows, row);
    if (fallbackBestRows.length < 3) fallbackBestRows.push(row);
    if (!activeRow && row[5]) activeRow = row;
    if (shouldRenderNodeRows && itemMatchesNodeSearch(item) && rowMatchesNodeFilter(row, nodePageFilter)) {
      matchingNodeCount += 1;
      if (nodeRows.length < nodeRenderLimit) nodeRows.push(row);
    }
    if (shouldRenderHomeRows && rowMatchesHomeFilter(row)) {
      rememberRankedRow(homeRows, row, compareHomeRows, homeNodeRenderLimit);
    }
    if (largeList && shouldRenderHomeRows && !shouldRenderNodeRows && homeRows.length >= homeNodeRenderLimit && index > largeNodeScanLimit) {
      break;
    }
    if (largeList && shouldRenderNodeRows && nodeRows.length >= nodeRenderLimit && (!shouldRenderHomeRows || homeRows.length >= homeNodeRenderLimit) && index > largeNodeScanLimit) {
      matchingNodeCount = Math.max(matchingNodeCount, nodeRows.length + 1);
      break;
    }
  }

  const visibleBestRows = bestRows.length ? bestRows : fallbackBestRows;
  activeRow = activeRow || visibleBestRows[0];
  currentProtocol = protocolLabel(activeRow?.[6] || 'direct');
  $('#protocolState').textContent = currentProtocol;
  $('#protocolMetric').textContent = currentProtocol;
  if (activeRow?.[1]) $('#nodeName').textContent = activeRow[1];

  if (shouldRenderNodeRows) {
    const nodeChildren = nodeRows.map((row) => renderNodeRow(row));
    if (matchingNodeCount > nodeRows.length) {
      nodeChildren.push(emptyState(`\u5df2\u663e\u793a\u524d ${nodeRows.length} \u4e2a\u8282\u70b9\uff0c\u8bf7\u641c\u7d22\u6216\u7b5b\u9009\u7f29\u5c0f\u8303\u56f4\u3002`));
    }
    replaceChildrenSafe($('#nodeRows'), nodeChildren.length ? nodeChildren : [emptyState('\u6682\u65e0\u7b26\u5408\u6761\u4ef6\u7684\u8282\u70b9\u3002')]);
  }
  const sortedHomeRows = homeRows;
  const homeFallbackRows = homeNodeMode === 'frequent' || homeNodeMode === 'region' ? fallbackBestRows : [];
  const homeEmptyText = homeNodeMode === 'favorite'
    ? '\u6682\u65e0\u6536\u85cf\u8282\u70b9\u3002'
    : homeNodeMode === 'fixed'
      ? '\u6682\u65e0\u56fa\u5b9a\u8282\u70b9\uff0c\u53ef\u70b9\u51fb\u201c\u6dfb\u52a0\u56fa\u5b9a\u8282\u70b9\u201d\u3002'
      : homeNodeMode === 'region'
        ? '\u6682\u65e0\u7b26\u5408\u8be5\u5730\u533a\u7684\u8282\u70b9\u3002'
        : '\u6682\u65e0\u5e38\u7528\u8282\u70b9\u3002';
  if (shouldRenderHomeRows) {
    const homeChildren = (sortedHomeRows.length ? sortedHomeRows : homeFallbackRows)
      .slice(0, homeNodeRenderLimit)
      .map((row) => renderHomeNodeRow(row));
    replaceChildrenSafe($('#homeNodeRows'), homeChildren.length ? homeChildren : [emptyState(homeEmptyText)]);
  }
  const summaryRows = activeRow
    ? [activeRow, ...stabilityRows.filter((row) => row !== activeRow)]
    : stabilityRows;
  renderHomeNodeSummary(summaryRows);
  if (options.transition) finishNodeListTransition();
}

function updateSelectedNodeDom(name) {
  const selected = String(name || '');
  $all('#nodeRows .row[data-node], #homeNodeRows .row[data-node]').forEach((row) => {
    row.classList.toggle('selected', row.dataset.node === selected);
  });
  if (selected) $('#nodeName').textContent = selected;
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
    item.append(
      el('span', { textContent: '\u6062\u590d\u7b56\u7565' }),
      el('b', { id: 'settingsTakeoverSummary', textContent: '\u63a5\u7ba1\u65f6\u8bb0\u5f55' })
    );
    summaryGrid.appendChild(item);
  }
  const proxySection = $('#systemProxyToggle')?.closest('.settings-section');
  if (proxySection && !$('#repairProxyBtn')) {
    const actions = document.createElement('div');
    actions.className = 'settings-actions';
    actions.append(el('button', { id: 'repairProxyBtn', className: 'ghost', textContent: '\u4fee\u590d\u63a5\u7ba1' }));
    proxySection.appendChild(actions);
    $('#repairProxyBtn').onclick = (event) => runButtonAction(event.currentTarget, '\u4fee\u590d\u4e2d...', repairSystemProxyJob);
  }
}

function renderProfiles() {
  const profiles = latestStatus?.settings?.profiles || [];
  const rows = profiles.map((profile) => {
    const pending = Boolean(profile.uiPending);
    const summary = pending ? profilePendingText(profile.uiPendingLabel) : profileSummaryText(profile);
    const id = profile.id || '';
    const className = `list-card ${id === latestStatus?.settings?.activeProfileId ? 'active' : ''} ${pending ? 'is-pending' : ''}`;
    return el('article', {
      className,
      dataset: { profileRow: id },
      attrs: { tabindex: '0', role: 'button', 'aria-busy': pending ? 'true' : 'false' }
    }, [
      el('div', {}, [
        el('b', { textContent: profile.name || id || '-' }),
        el('small', { textContent: `${profile.profile_type || '-'} / ${profile.updated_at || '-'}` })
      ]),
      el('small', { className: 'profile-source-summary', textContent: summary }),
      el('div', { className: 'card-actions' }, [
        el('button', { dataset: { profileSwitch: id }, textContent: '\u542f\u7528' }),
        el('button', { dataset: { profileRename: id }, textContent: '\u91cd\u547d\u540d', disabled: id === 'direct' }),
        el('button', { dataset: { profileUpdate: id }, textContent: '\u66f4\u65b0' }),
        el('button', { dataset: { profileRemove: id }, textContent: '\u5220\u9664', disabled: id === 'direct' })
      ])
    ]);
  });
  replaceChildrenSafe($('#profileRows'), rows.length ? rows : [emptyState('\u6682\u65e0\u8ba2\u9605\u3002')]);
}

function renderQuickProfileMenu(options = {}) {
  const menu = $('#profileMenu');
  if (!menu) return;
  if (!options.force && !menu.classList.contains('hidden')) return;
  const profiles = latestStatus?.settings?.profiles || [];
  const activeId = latestStatus?.settings?.activeProfileId || '';
  const rows = profiles.map((profile) => {
    const active = profile.id === activeId;
    return el('button', {
      className: active ? 'active' : '',
      dataset: { profileSwitch: profile.id }
    }, [
      el('b', { textContent: profile.name || profile.id }),
      el('small', { textContent: profileSummaryText(profile) })
    ]);
  });
  replaceChildrenSafe(menu, rows.length ? rows : [emptyState('\u6682\u65e0\u8ba2\u9605')]);
}

function positionQuickProfileMenu() {
  const menu = $('#profileMenu');
  const button = profileMenuAnchor || $('#quickProfileBtn') || $('#nodeProfileBtn');
  if (!menu || !button || menu.classList.contains('hidden')) return;
  const buttonBox = button.getBoundingClientRect();
  const menuWidth = Math.min(320, Math.max(240, window.innerWidth - 28));
  const viewportLeft = Math.min(
    Math.max(14, buttonBox.left + buttonBox.width / 2 - menuWidth / 2),
    Math.max(14, window.innerWidth - menuWidth - 14)
  );
  const viewportTop = Math.min(buttonBox.bottom + 8, Math.max(14, window.innerHeight - 140));
  menu.style.width = `${menuWidth}px`;
  menu.style.left = `${viewportLeft}px`;
  menu.style.top = `${viewportTop}px`;
  menu.style.maxHeight = `${Math.max(120, window.innerHeight - viewportTop - 14)}px`;
}

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
  $('#settingsRuntimeSummary').textContent = latestStatus?.trafficTakeover
    ? (settings.tunEnabled ? 'TUN 接管中' : settings.systemProxy ? '系统代理接管' : '核心运行中')
    : latestStatus?.coreReady
    ? '核心待命'
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
  const rows = logs.slice(-logRenderLimit).reverse().map((entry) => el('div', { className: 'log-row' }, [
    el('span', { textContent: entry.at }),
    el('b', { textContent: entry.level }),
    el('em', { textContent: logCategoryLabel(entry.category, entry.level) }),
    el('code', { textContent: entry.line })
  ]));
  replaceChildrenSafe($('#logRows'), rows.length ? rows : [emptyState('\u6682\u65e0\u5339\u914d\u65e5\u5fd7\u3002')]);
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

function setOutboundIpText(value) {
  const text = value || '-';
  $('#outboundIpState').textContent = text;
  $('#outboundMetric').textContent = text;
}

function renderOutboundIpFromStatus(value) {
  if (outboundIpPendingSeq) return;
  outboundIpLastStable = value || outboundIpLastStable || '-';
  setOutboundIpText(outboundIpLastStable);
}

function renderStatus(status) {
  const wasTakeover = latestStatus?.trafficTakeover;
  latestStatus = status;

  const settings = status.settings || {};
  const protection = status.protection || {};
  const activeProfile = status.activeProfile || {};
  const traffic = status.traffic || {};
  const coreReady = Boolean(status.coreReady ?? status.running);
  const trafficTakeover = Boolean(status.trafficTakeover || settings.proxyTakeover?.active);
  const systemProxyApplied = trafficTakeover && Boolean(settings.systemProxy);
  if (trafficTakeover && !wasTakeover) startedAt = Date.now();
  if (!trafficTakeover) startedAt = Date.now();
  const modeText = modeLabel(status.mode);

  $('#appVersionLabel').textContent = `v${status.appVersion || defaultAppVersion}`;
  $('.ring strong').textContent = trafficTakeover ? '已连接' : coreReady ? '核心待命' : '未连接';
  $('.ring').classList.toggle('offline', !trafficTakeover);
  $('#nodeName').textContent = selectedNode || latestGroup?.now || activeProfile.name || '等待节点数据';
  const nodeHost = $('#nodeHost');
  if (nodeHost) nodeHost.textContent = status.network?.proxyEndpoint || '-';
  $('#connectBtn').textContent = trafficTakeover ? '断开连接' : '连接';
  $('#modeLabel').textContent = modeText;
  setNotice(`${protection.label || '未接管'}：${trafficTakeover ? '正在按当前策略接管流量。' : coreReady ? '可测速，未接管系统流量。' : '内核未运行，当前没有流量接管。'}`);

  $('#protectMode').textContent = protection.label || '未接管';
  $('#dnsState').textContent = settings.dnsHijackEnabled === false ? '未开启' : '已开启';
  $('#tunState').textContent = settings.tunEnabled ? '已开启' : '未开启';
  $('#killState').textContent = settings.killSwitchEnabled ? '已开启' : '未开启';
  $('#quickKillBtn')?.classList.toggle('active', Boolean(settings.killSwitchEnabled));
  $('#proxyState').textContent = systemProxyApplied ? '已开启' : settings.systemProxy ? '待连接' : '未开启';
  $('#proxyStateRow').classList.toggle('hidden', !settings.systemProxy);
  $('#protocolState').textContent = currentProtocol;
  $('#protocolMetric').textContent = currentProtocol;
  $('#tunHomeToggle').checked = Boolean(settings.tunEnabled);
  $('#tunHomeState').textContent = settings.tunEnabled ? '已开启' : '未开启';
  $('#lanIpState').textContent = status.network?.lanIp || '-';
  $('#proxyPortState').textContent = formatProxyPort(status.network?.proxyEndpoint);
  renderOutboundIpFromStatus(status.network?.outboundIp || '-');
  $('#proxyMetric').textContent = formatProxyPort(status.network?.proxyEndpoint);
  $('#systemProxyMetric').textContent = systemProxyApplied ? '已开启' : settings.systemProxy ? '待连接' : '未开启';
  $('#systemProxyMetric').classList.toggle('is-danger', !systemProxyApplied);

  const up = formatRate(traffic.up);
  const down = formatRate(traffic.down);
  if ($('#upRate')) $('#upRate').textContent = up;
  if ($('#downRate')) $('#downRate').textContent = down;
  renderActiveConnectionMetric();
  renderHomeNodeSummary();
  renderSettings(status);
  if (isPageActive('profiles')) renderProfiles();
  if (isPageActive('logs')) renderLogs();
  renderQuickProfileMenu();
  warmStaticPageCaches();
}

function applyOptimisticMode(mode) {
  if (latestStatus) latestStatus = { ...latestStatus, mode };
  $('#modeLabel').textContent = modeLabel(mode);
}

function applyOptimisticProfile(profileId) {
  if (!latestStatus?.settings) return;
  resetSpeedUiForProfileSwitch();
  const profiles = latestStatus.settings.profiles || [];
  const profile = profiles.find((item) => item.id === profileId);
  latestStatus = {
    ...latestStatus,
    activeProfile: profile ? { ...(latestStatus.activeProfile || {}), ...profile } : latestStatus.activeProfile,
    settings: { ...latestStatus.settings, activeProfileId: profileId }
  };
  renderStatus(latestStatus);
  renderProfiles();
  void previewProfileNodes(profileId);
}

function applyOptimisticNode(name) {
  selectedNode = name;
  if (name) {
    nodeUsageCounts.set(name, Number(nodeUsageCounts.get(name) || 0) + 1);
    saveNodeUsageCounts();
  }
  if (latestGroup) setLatestGroup({ ...latestGroup, now: name });
  updateSelectedNodeDom(name);
}

function findNodeItem(name) {
  const index = nodeIndexForName(name);
  return index == null ? null : (latestGroup?.items || [])[index] || null;
}

function updateNodeDelayDom(name, delay, failureReason = '') {
  const value = Number(delay);
  $all('.row[data-node]').forEach((row) => {
    if (row.dataset.node !== name) return;
    const delayCell = row.querySelector('.node-delay');
    if (delayCell) {
      delayCell.className = `node-delay ${delayClass(value)}`;
      delayCell.textContent = delayText(value);
    }
    const noteCell = row.querySelector('.node-note');
    if (noteCell) {
      const note = nodeSpeedNoteInfo([null, name, null, value, null, null, null, null, null, null, null, null, value < 0 ? 1 : 0, null, null, null, value === 0 ? 'testing' : value > 0 ? 'medium' : 'failed', value === 0 ? 0 : Math.floor(Date.now() / 1000), failureReason]);
      noteCell.className = note.className;
      noteCell.textContent = note.label;
      noteCell.setAttribute('title', note.title);
    }
  });
  renderHomeNodeSummary(summaryRowsFromLatestGroup());
}

function applyOptimisticNodeDelay(name, delay, failureReason = '') {
  if (!latestGroup?.items) return;
  setLatestGroup({
    ...latestGroup,
    items: latestGroup.items.map((item) => {
      if (item.name !== name && item.realProxyName !== name) return item;
      const nextDelay = Number(delay);
      return {
        ...item,
        delay: nextDelay,
        medianDelay: nextDelay > 0 ? nextDelay : item.medianDelay,
        alive: nextDelay >= 0 || item.alive !== false,
        healthStatus: nextDelay === 0 ? 'testing' : nextDelay > 0 && nextDelay < 100 ? 'low' : nextDelay >= 100 ? 'available' : 'unstable',
        healthConfidence: nextDelay === 0 ? 'testing' : nextDelay > 0 ? item.healthConfidence : 'failed',
        failureStreak: nextDelay < 0 ? Math.max(1, Number(item.failureStreak || 0)) : item.failureStreak,
        lastFailureReason: nextDelay < 0 ? (failureReason || 'timeout') : '',
        lastTestedAt: nextDelay === 0 ? item.lastTestedAt : Math.floor(Date.now() / 1000)
      };
    })
  });
  updateNodeDelayDom(name, delay, failureReason);
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

async function exportLogs() {
  const result = await invoke('export_logs');
  const path = result?.path || '';
  if (path) {
    setNotice(`日志已导出：${path}`);
  } else {
    setNotice('日志已导出。');
  }
  return result;
}

function removeConnectionElement(button) {
  const row = button?.closest('.simple-row');
  if (row) row.remove();
  if (!$('#connectionRows')?.querySelector('.simple-row')) {
    replaceChildrenSafe($('#connectionRows'), [emptyState('\u5f53\u524d\u6ca1\u6709\u6d3b\u52a8\u8fde\u63a5\u3002')]);
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
      permissions: { isAdmin: false, requiresAdminFor: ['TUN', '\u65ad\u7f51\u4fdd\u62a4'] },
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

function renderActiveConnectionMetric() {
  const metric = $('#activeConnectionsMetric');
  if (metric) metric.textContent = String(activeConnectionCount || 0);
}

async function refreshActiveConnectionCount(force = false) {
  if (activeConnectionBusy) return;
  if (!latestStatus?.trafficTakeover) {
    activeConnectionCount = 0;
    renderActiveConnectionMetric();
    return;
  }
  if (!force && isForegroundHot()) return;
  if (!force && (foregroundBusy > 0 || backgroundJobBusy > 0 || isSpeedTestActive())) return;
  const now = Date.now();
  if (!force && now - lastActiveConnectionAt < 5000) return;
  lastActiveConnectionAt = now;
  activeConnectionBusy = true;
  try {
    const result = await invoke('active_connection_count');
    activeConnectionCount = Number(result?.count || 0);
  } catch {
    activeConnectionCount = activeConnectionCount || 0;
  } finally {
    activeConnectionBusy = false;
    renderActiveConnectionMetric();
  }
}

async function refreshNodes(force = false, options = {}) {
  if (nodeBusy) return;
  if (!force && isForegroundHot()) return;
  if (!force && (foregroundBusy > 0 || backgroundJobBusy > 0)) return;
  nodeBusy = true;
  try {
    const groups = await invoke('proxy_groups');
    setLatestGroup(Array.isArray(groups) ? (groups.find((group) => group.name === 'GLOBAL') || groups[0]) : null);
    selectedNode = latestGroup?.now || selectedNode;
    scheduleRowsRender(latestGroup?.items || [], { force, target: options.target || 'all' });
  } catch {
    setLatestGroup(null);
    if (isNodeSurfaceActive()) renderRows();
    else pendingRowItems = [];
  } finally {
    nodeBusy = false;
  }
}

async function previewProfileNodes(profileId) {
  const previewSeq = ++profilePreviewSeq;
  try {
    const groups = await invoke('preview_profile_groups', { id: profileId });
    const stillActive = latestStatus?.settings?.activeProfileId === profileId;
    if (previewSeq !== profilePreviewSeq || !stillActive) return;
    const group = Array.isArray(groups) ? (groups.find((item) => item.name === 'GLOBAL') || groups[0]) : null;
    if (!group || !Array.isArray(group.items) || !group.items.length) return;
    setLatestGroup(group);
    selectedNode = group.now || '';
    pendingRowItems = group.items;
    scheduleRowsRender(group.items, { force: true, target: 'all', delay: 40, transition: true });
    renderHomeNodeSummary(summaryRowsFromLatestGroup());
  } catch {
    // Preview is an opportunistic UI fast path; the verified refresh still follows the real profile switch.
  }
}

async function initializeAppData() {
  await refreshStatus(true);
  const activeProfileId = latestStatus?.settings?.activeProfileId;
  if (activeProfileId) void previewProfileNodes(activeProfileId);
  await refreshNodes(true);
}

function stopSpeedTestPolling() {
  if (speedTestTimer) clearInterval(speedTestTimer);
  speedTestTimer = null;
  speedTestStarting = false;
  activeSpeedRunId = 0;
  speedTestButtons.forEach((button) => setButtonBusy(button, false, '', { preserveContent: true }));
  speedTestButtons.clear();
}

function resetSpeedUiForProfileSwitch() {
  profilePreviewSeq += 1;
  stopSpeedTestPolling();
  latestSpeedStatus = null;
  lastAppliedSpeedSignature = '';
  lastSpeedNodeRefreshAt = 0;
  selectedNode = '';
  beginNodeListTransition();
  if (rowRenderFrame) clearTimeout(rowRenderFrame);
  rowRenderFrame = null;
  pendingRowItems = latestGroup?.items || [];
  pendingRowTarget = null;
  pendingRowTransition = false;
}

async function pollSpeedTest() {
  try {
    const status = await invoke('speed_test_status');
    if (activeSpeedRunId && status.runId && status.runId !== activeSpeedRunId) {
      stopSpeedTestPolling();
      return;
    }
    applySpeedStatusToNodes(status);
    if (status.running) {
      setNotice(`正在测速：${status.completed || 0}/${status.total || 0}，成功 ${status.ok || 0}，失败 ${status.failed || 0}`);
      return;
    }
    await refreshVisibleNodesForSpeed(true);
    stopSpeedTestPolling();
    setNotice(`节点测速已完成：成功 ${status.ok || 0}，失败 ${status.failed || 0}，共 ${status.total || 0} 个。`);
  } catch (err) {
    stopSpeedTestPolling();
    setNotice(`读取测速进度失败：${err.message || err}`);
  }
}

async function testNodes(button = null) {
  if (speedTestTimer || speedTestStarting) return;
  speedTestStarting = true;
  latestSpeedStatus = null;
  lastAppliedSpeedSignature = '';
  if (button) {
    speedTestButtons.add(button);
    setButtonBusy(button, true, '\u6d4b\u901f\u4e2d...', { preserveContent: true });
  }
  setNotice('\u6d4b\u901f\u5df2\u53d1\u9001\u5230\u540e\u53f0\uff0c\u754c\u9762\u53ef\u7ee7\u7eed\u64cd\u4f5c\u3002');
  try {
    const status = await invoke('start_proxy_delay_test');
    activeSpeedRunId = Number(status.runId || 0);
    applySpeedStatusToNodes(status, { force: true });
    lastSpeedNodeRefreshAt = 0;
    if (!latestGroup?.items?.length) queueNodeRefresh('all', 0);
    setNotice(`\u6d4b\u901f\u5df2\u5728\u540e\u53f0\u5f00\u59cb\uff1a0/${status.total || 0}`);
    speedTestTimer = setInterval(pollSpeedTest, speedTestPollMs);
    await pollSpeedTest();
  } catch (err) {
    stopSpeedTestPolling();
    setNotice(`\u8282\u70b9\u6d4b\u901f\u5931\u8d25\uff1a${err.message || err}`);
  }
}
async function refreshOutboundIpJob() {
  return refreshOutboundIpAfterNodeChange({ manual: true });
}

async function refreshOutboundIpAfterNodeChange(options = {}) {
  const seq = ++outboundIpRequestSeq;
  outboundIpPendingSeq = seq;
  setOutboundIpText('\u67e5\u8be2\u4e2d');
  if (options.manual) setNotice('\u6b63\u5728\u540e\u53f0\u67e5\u8be2\u843d\u5730 IP...');
  const result = await runBackgroundJob('refreshOutboundIp', {}, {
    pendingNotice: options.manual ? '\u6b63\u5728\u540e\u53f0\u67e5\u8be2\u843d\u5730 IP...' : '',
    onSuccess: async (value) => {
      if (seq !== outboundIpRequestSeq) return;
      const ip = value?.ip || '-';
      outboundIpPendingSeq = 0;
      outboundIpLastStable = ip;
      await refreshStatus(true);
      setOutboundIpText(ip);
    },
    successNotice: (value) => seq === outboundIpRequestSeq && options.manual ? `\u843d\u5730 IP \u5df2\u5237\u65b0\uff1a${value?.ip || '-'}` : '',
    failureNotice: (err) => seq === outboundIpRequestSeq && options.manual ? `\u5237\u65b0\u843d\u5730 IP \u5931\u8d25\uff1a${err.message || err}` : ''
  });
  if (seq !== outboundIpRequestSeq) return null;
  if (!result) {
    outboundIpPendingSeq = 0;
    setOutboundIpText(outboundIpLastStable && outboundIpLastStable !== '\u67e5\u8be2\u4e2d' ? outboundIpLastStable : '-');
  }
  return result;
}

async function refreshOutboundIp() {
  return refreshOutboundIpAfterNodeChange({ manual: true });
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

async function renameProfileJob(id, name) {
  return runBackgroundJob('renameProfile', { id, name }, {
    pendingNotice: '\u6b63\u5728\u540e\u53f0\u91cd\u547d\u540d\u8ba2\u9605...',
    successNotice: '\u8ba2\u9605\u5df2\u91cd\u547d\u540d\u3002',
    failureNotice: (err) => `\u8ba2\u9605\u91cd\u547d\u540d\u5931\u8d25\uff1a${err.message || err}`
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
  const targetTakeover = kind === 'stopCore' ? false : true;
  if (latestStatus) {
    latestStatus = {
      ...latestStatus,
      running: targetTakeover,
      coreReady: targetTakeover,
      trafficTakeover: targetTakeover,
      standby: false
    };
    renderStatus(latestStatus);
  }
  const result = await runBackgroundJob(kind, {}, {
    pendingNotice: options.pendingNotice,
    progressNotice: (job) => job?.message ? `${job.label}：${job.message}` : '',
    onSuccess: async () => {
      await refreshStatus(true);
      await refreshNodes(true);
      if (kind === 'startCore') void refreshOutboundIpAfterNodeChange();
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
  if (reliability.auto === false || !latestStatus?.trafficTakeover || recoveryBusy) return;
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
  if (button?.dataset.busy === 'true') return;
  setButtonBusy(button, true, '', { preserveContent: true });
  try {
    const stopping = Boolean(latestStatus?.trafficTakeover);
    setNotice(stopping ? '正在断开连接...' : '正在启动连接...');
    await corePowerJob(stopping ? 'stopCore' : 'startCore', {
      pendingNotice: stopping ? '正在后台断开连接...' : '正在后台启动连接...',
      successNotice: stopping ? '已断开连接。' : '已连接，核心正在运行。',
      failureNotice: (err) => `核心操作失败：${err.message || err}`
    });
    setNotice(latestStatus?.trafficTakeover ? '已连接，核心正在运行。' : '已断开连接。');
  } catch (err) {
    setNotice(`操作失败：${err.message || err}`);
  } finally {
    setButtonBusy(button, false, '', { preserveContent: true });
    if (latestStatus) renderStatus(latestStatus);
  }
}

function toggleModeMenu() {
  $('#modeMenu').classList.toggle('hidden');
}

function toggleProfileMenu(anchor = $('#quickProfileBtn')) {
  const menu = $('#profileMenu');
  if (!menu) return;
  if (menu.classList.contains('hidden')) {
    profileMenuAnchor = anchor || $('#quickProfileBtn') || $('#nodeProfileBtn');
    $('#modeMenu')?.classList.add('hidden');
    renderQuickProfileMenu({ force: true });
    menu.classList.remove('hidden');
    positionQuickProfileMenu();
  } else {
    menu.classList.add('hidden');
    profileMenuAnchor = null;
  }
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
    refresh: async (result) => {
      await refreshNodes(true, { target: 'nodes' });
      if (result) void refreshOutboundIpAfterNodeChange();
    },
    pendingNotice: '正在后台切换节点...',
    successNotice: (result) => result ? `已切换节点：${name}` : '',
    failureNotice: (err) => `切换节点失败：${err.message || err}`
  });
}

async function captureNodeDiagnostics(name) {
  if (!name) return null;
  try {
    const data = await invoke('node_diagnostics', { name });
    const failure = data?.lastFailure;
    const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
    const reason = failure?.classification || data?.health?.status || 'unknown';
    appendLocalLog(
      failure ? 'warn' : 'info',
      'diagnostic',
      `Node diagnostics: ${name} / ${reason} / suggestions ${suggestions.length}`
    );
    return data;
  } catch (err) {
    appendLocalLog('warn', 'diagnostic', `Node diagnostics failed: ${name} / ${err.message || err}`);
    return null;
  }
}

function singleNodeResultFromSpeedStatus(status = {}, name = '') {
  const item = findNodeItem(name) || {};
  const realName = item.realProxyName || name;
  const delays = status.delays || {};
  const health = status.health || {};
  const itemHealth = health[realName] || health[name] || {};
  const hasDelay = Object.prototype.hasOwnProperty.call(delays, realName)
    || Object.prototype.hasOwnProperty.call(delays, name);
  const rawDelay = hasDelay ? (delays[realName] ?? delays[name]) : speedHealthValue(itemHealth, 'lastDelay', 'last_delay');
  const delay = rawDelay == null ? Number(item.delay ?? -1) : Number(rawDelay);
  const reason = speedHealthValue(itemHealth, 'lastFailureReason', 'last_failure_reason')
    || status.error
    || '';
  const healthStatus = speedHealthValue(itemHealth, 'status') || '';
  return { delay, reason, healthStatus };
}

async function waitForSingleNodeDelay(name, runId, timeoutMs = 12000) {
  const startedAt = Date.now();
  let lastResult = { delay: 0, reason: '', healthStatus: 'testing' };
  while (Date.now() - startedAt < timeoutMs) {
    const status = await invoke('speed_test_status');
    if (runId && status.runId && Number(status.runId) !== Number(runId)) break;
    applySpeedStatusToNodes(status);
    lastResult = singleNodeResultFromSpeedStatus(status, name);
    const finished = !status.running && (lastResult.delay !== 0 || lastResult.reason || status.error);
    if (finished) return lastResult;
    await sleep(speedTestPollMs);
  }
  return { ...lastResult, delay: -1, reason: lastResult.reason || 'timeout' };
}

async function testSingleNode(name, button) {
  if (!name) return;
  applyOptimisticNodeDelay(name, 0);
  try {
    await runLocalButtonAction(button, '\u6d4b\u901f\u4e2d...', async () => {
      const queued = await invoke('test_single_proxy_delay', { name });
      const runId = Number(queued?.runId || 0);
      const result = runId > 0
        ? await waitForSingleNodeDelay(name, runId)
        : {
            delay: Number(queued?.delay ?? -1),
            reason: queued?.reason || queued?.lastFailureReason || queued?.last_failure_reason || (Number(queued?.delay ?? -1) > 0 ? '' : 'probe-failed'),
            healthStatus: queued?.healthStatus || queued?.status || ''
          };
      const reason = result?.reason || '';
      applyOptimisticNodeDelay(name, Number(result?.delay ?? -1), reason);
      queueNodeRefresh(activeNodeRenderTarget(), 0);
      const delay = Number(result?.delay ?? -1);
      if (delay > 0) {
        setNotice(`\u8282\u70b9\u6d4b\u901f\u5b8c\u6210\uff1a${name} / ${Math.round(delay)} ms`);
      } else {
        setNotice(`\u8282\u70b9\u6d4b\u901f\u5931\u8d25\uff1a${name} / ${speedFailureReasonLabel(reason)}`);
        void captureNodeDiagnostics(name);
      }
    });
  } catch (err) {
    applyOptimisticNodeDelay(name, -1, 'network');
    setNotice(`\u8282\u70b9\u6d4b\u901f\u5931\u8d25\uff1a${name} / ${err.message || err}`);
    void captureNodeDiagnostics(name);
  }
}

async function testCurrentNode(button) {
  const name = selectedNode || latestGroup?.now || $('#nodeName')?.textContent?.trim();
  if (!name || name === '-' || name.includes('\u7b49\u5f85')) {
    setNotice('\u6682\u65e0\u53ef\u6d4b\u901f\u7684\u5f53\u524d\u8282\u70b9\u3002');
    return;
  }
  await testSingleNode(name, button);
}

function setEditorValue(selector, value) {
  const el = $(selector);
  if (el) el.value = value ?? '';
}

function closeNodeEditor() {
  $('#nodeEditorOverlay')?.classList.add('hidden');
}

function openNodeEditor(name = '') {
  const item = name ? findNodeItem(name) : null;
  const protocol = (item?.type || item?.protocol || 'ss').toLowerCase();
  setEditorValue('#nodeOriginalNameInput', item?.name || '');
  setEditorValue('#nodeEditNameInput', item?.name || '');
  setEditorValue('#nodeEditTypeSelect', ['ss', 'trojan', 'vmess', 'vless', 'socks5', 'http', 'hysteria2', 'hy2', 'anytls', 'tuic'].includes(protocol) ? protocol : 'ss');
  setEditorValue('#nodeEditServerInput', item?.server || '');
  setEditorValue('#nodeEditPortInput', item?.port || '');
  setEditorValue('#nodeEditSecretInput', item?.password || item?.uuid || '');
  setEditorValue('#nodeEditCipherInput', item?.cipher || (protocol === 'vmess' ? 'auto' : ''));
  const tls = $('#nodeEditTlsToggle');
  if (tls) tls.checked = Boolean(item?.tls);
  const udp = $('#nodeEditUdpToggle');
  if (udp) udp.checked = item?.udp !== false;
  $('#nodeEditorOverlay')?.classList.remove('hidden');
  $('#nodeEditNameInput')?.focus();
  setNotice(item ? `\u7f16\u8f91\u8282\u70b9\uff1a${item.name}` : '\u6dfb\u52a0\u56fa\u5b9a\u8282\u70b9');
}

function collectNodeEditorPayload() {
  const type = $('#nodeEditTypeSelect')?.value || 'ss';
  const secret = $('#nodeEditSecretInput')?.value.trim() || '';
  const cipher = $('#nodeEditCipherInput')?.value.trim() || '';
  const payload = {
    originalName: $('#nodeOriginalNameInput')?.value.trim() || '',
    name: $('#nodeEditNameInput')?.value.trim() || '',
    type,
    server: $('#nodeEditServerInput')?.value.trim() || '',
    port: Number($('#nodeEditPortInput')?.value || 0),
    tls: Boolean($('#nodeEditTlsToggle')?.checked),
    udp: $('#nodeEditUdpToggle')?.checked !== false,
    manual: true,
    fixed: true,
    static: true
  };
  if (type === 'vmess' || type === 'vless' || type === 'tuic') payload.uuid = secret;
  else if (secret) payload.password = secret;
  if (cipher) payload.cipher = cipher;
  return payload;
}

async function saveNodeEditor(event) {
  event.preventDefault();
  const button = $('#saveNodeEditorBtn');
  await runButtonAction(button, '\u4fdd\u5b58\u4e2d...', async () => {
    const payload = collectNodeEditorPayload();
    const result = await invoke('save_manual_node', { node: payload });
    if (result?.settings && latestStatus?.settings) {
      latestStatus = { ...latestStatus, settings: result.settings };
    }
    const savedNode = { ...payload, ...(result?.node || {}), alive: true, delay: -1, manual: true, fixed: true, static: true, source: 'manual' };
    if (latestGroup) {
      const originalName = payload.originalName || savedNode.name;
      const items = latestGroup.items || [];
      const replaced = items.some((item) => item.name === originalName || item.name === savedNode.name);
      setLatestGroup({
        ...latestGroup,
        items: replaced
          ? items.map((item) => (item.name === originalName || item.name === savedNode.name ? { ...item, ...savedNode } : item))
          : [...items, savedNode]
      });
      renderRows(latestGroup.items);
    }
    closeNodeEditor();
    await refreshNodes(true);
    setNotice(`\u56fa\u5b9a\u8282\u70b9\u5df2\u4fdd\u5b58\uff1a${payload.name}`);
  });
}

function toggleFavoriteNode(name) {
  if (!name) return;
  if (favoriteNodes.has(name)) {
    favoriteNodes.delete(name);
    setNotice(`\u5df2\u53d6\u6d88\u6536\u85cf\uff1a${name}`);
  } else {
    favoriteNodes.add(name);
    setNotice(`\u5df2\u6536\u85cf\u8282\u70b9\uff1a${name}`);
  }
  saveFavoriteNodes();
  renderRows(latestGroup?.items || []);
}

async function lockAutoGroupJob() {
  const group = latestGroup?.name || '';
  const proxy = latestGroup?.now || selectedNode || '';
  if (!group || !proxy) {
    setNotice('暂无可锁定的当前节点。');
    return;
  }
  if (!isAutoStrategyGroup(latestGroup)) {
    setNotice('当前已是手动策略组或非自动组。');
    return;
  }
  await runOptimisticAction({
    apply: () => applyOptimisticNode(proxy),
    commit: () => runBackgroundJob('changeProxy', { group, proxy }, {
      pendingNotice: '正在锁定当前节点...',
      failureNotice: (err) => `锁定当前节点失败：${err.message || err}`
    }),
    refresh: async (result) => {
      await refreshNodes(true);
      if (result) void refreshOutboundIpAfterNodeChange();
    },
    pendingNotice: '已请求锁定当前节点...',
    successNotice: (result) => result ? `已锁定当前节点：${proxy}` : '',
    failureNotice: (err) => `锁定当前节点失败：${err.message || err}`
  });
}

async function updateSetting(key, value) {
  if (value && ['tunEnabled', 'killSwitchEnabled'].includes(key) && !latestStatus?.permissions?.isAdmin) {
    await refreshStatus(true);
    setNotice('TUN 和断网保护需要管理员权限，请先在设置中以管理员身份重启 Aegos。');
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
    const rows = (Array.isArray(items) ? items : []).map((item) => {
      const chains = Array.isArray(item.chains) ? item.chains.join(' ? ') : '-';
      const traffic = `${formatRate(item.upload)} / ${formatRate(item.download)}`;
      const target = item.metadata?.host || item.metadata?.destinationIP || item.id || '-';
      return el('div', { className: 'simple-row' }, [
        el('span', { textContent: target }),
        el('span', { textContent: item.rule || '-' }),
        el('span', { textContent: chains }),
        el('span', { textContent: traffic }),
        el('button', { dataset: { closeConnection: item.id }, textContent: '\u5173\u95ed' })
      ]);
    });
    replaceChildrenSafe($('#connectionRows'), rows.length ? rows : [emptyState('\u5f53\u524d\u6ca1\u6709\u6d3b\u52a8\u8fde\u63a5\u3002')]);
    markPageCache('connections');
  } catch (err) {
    if (!isCurrentPageTask(token, 'connections')) return;
    replaceChildrenSafe($('#connectionRows'), [emptyState(`\u8fde\u63a5\u7ba1\u7406\u4e0d\u53ef\u7528\uff1a${err.message || err}`)]);
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
    `Core ready: ${status.coreReady || status.running ? 'yes' : 'no'}`,
    `Traffic takeover: ${status.trafficTakeover ? 'yes' : 'no'}`,
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
  const statusText = errors > 0 ? '\u9700\u8981\u5904\u7406' : warnings > 0 ? '\u9700\u8981\u5173\u6ce8' : '\u72b6\u6001\u6b63\u5e38';
  const nextActions = Array.isArray(summary.nextActions) && summary.nextActions.length
    ? summary.nextActions
    : checks.filter((item) => item.actionable).map((item) => item.hint).filter(Boolean).slice(0, 3);
  replaceChildrenSafe($('#diagSummary'), [
    el('div', { className: `diagnostic-status ${statusClass}` }, [
      el('b', { textContent: statusText }),
      el('span', { textContent: `${checks.length} \u9879\u68c0\u67e5 / ${failed} \u9879\u5f02\u5e38` })
    ]),
    el('div', { className: 'diagnostic-metrics' }, [
      el('span', {}, [el('b', { textContent: errors }), text('\u9519\u8bef')]),
      el('span', {}, [el('b', { textContent: warnings }), text('\u8b66\u544a')]),
      el('span', {}, [el('b', { textContent: checks.length - failed }), text('\u901a\u8fc7')])
    ]),
    el('div', { className: 'diagnostic-actions' }, nextActions.length
      ? nextActions.map((action) => el('small', { textContent: action }))
      : [el('small', { textContent: '\u672a\u53d1\u73b0\u9700\u8981\u7acb\u5373\u5904\u7406\u7684\u95ee\u9898\u3002' })])
  ]);
}

function renderDiagnosticRows(checks) {
  const sorted = [...checks].sort((a, b) => diagnosticSeverityRank(a) - diagnosticSeverityRank(b));
  const rows = sorted.map((item) => el('article', { className: `list-card diagnostic-row severity-${item.severity}` }, [
    el('div', {}, [
      el('b', { textContent: item.name }),
      el('small', { textContent: item.detail }),
      item.hint ? el('small', { className: 'diagnostic-hint', textContent: item.hint }) : null
    ]),
    el('span', { className: item.ok ? 'ok' : item.severity === 'error' ? 'bad' : 'warn', textContent: diagnosticSeverityLabel(item) })
  ]));
  replaceChildrenSafe($('#diagRows'), rows.length ? rows : [emptyState('\u6682\u65e0\u8bca\u65ad\u7ed3\u679c\u3002')]);
}

function renderCachedDiagnostics() {
  if (latestDiagnostics) {
    const checks = (latestDiagnostics.checks || []).map(normalizeDiagnosticCheck);
    renderDiagnosticSummary(latestDiagnostics, checks);
    renderDiagnosticRows(checks);
    return;
  }
  replaceChildrenSafe($('#diagSummary'), [
    el('div', { className: 'diagnostic-status' }, [
      el('b', { textContent: '\u7b49\u5f85\u8bca\u65ad' }),
      el('span', { textContent: '\u70b9\u51fb\u8fd0\u884c\u8bca\u65ad\u540e\u67e5\u770b\u5f53\u524d\u7ed3\u679c\u3002' })
    ])
  ]);
  replaceChildrenSafe($('#diagRows'), [emptyState('\u5c1a\u672a\u8fd0\u884c\u8bca\u65ad\u3002')]);
}

async function runDiagnostics(showNotice = true, token = null) {
  if (pageCacheState.diagnostics.loading) return;
  pageCacheState.diagnostics.loading = true;
  try {
    const data = await runBackgroundJob('diagnostics', {}, {
      pendingNotice: showNotice ? '诊断已开始，正在后台运行...' : '',
      progressNotice: () => '',
      pollMs: 300
    });
    if (!data) return;
    latestDiagnostics = data;
    if (!isCurrentPageTask(token, 'diagnostics')) {
      markPageCache('diagnostics');
      return;
    }
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
    replaceChildrenSafe($('#diagSummary'), [
      el('div', { className: 'diagnostic-status is-bad' }, [
        el('b', { textContent: '\u8bca\u65ad\u4e0d\u53ef\u7528' }),
        el('span', { textContent: '\u65e0\u6cd5\u8bfb\u53d6\u8bca\u65ad\u7ed3\u679c' })
      ])
    ]);
    replaceChildrenSafe($('#diagRows'), [emptyState(`\u8bca\u65ad\u5931\u8d25\uff1a${err.message || err}`)]);
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
}

function tick() {
  const value = formatClock();
  $('#sessionClock').textContent = value;
  const metricClock = $('#metricClock');
  if (metricClock) metricClock.textContent = value;
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
$('#currentNodeTestBtn')?.addEventListener('click', (event) => {
  event.stopPropagation();
  testCurrentNode(event.currentTarget);
});
if ($('#refreshNodesBtn')) $('#refreshNodesBtn').onclick = refreshNodes;
$('#modeBtn').onclick = toggleModeMenu;
$('#quickKillBtn')?.addEventListener('click', (event) => runButtonAction(event.currentTarget, '切换中...', () => updateSetting('killSwitchEnabled', !latestStatus?.settings?.killSwitchEnabled), { preserveContent: true }));
$('#quickTestBtn').onclick = (event) => testNodes(event.currentTarget);
$('#quickUpdateSubBtn').onclick = (event) => runButtonAction(event.currentTarget, '更新中...', updateActiveProfile);
$('#quickProxyBtn').onclick = () => updateSetting('systemProxy', !latestStatus?.settings?.systemProxy);
$('#quickProfileBtn')?.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  toggleProfileMenu(event.currentTarget);
});
$('#quickProfileBtn')?.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (event.detail === 0) toggleProfileMenu(event.currentTarget);
});
$('#nodeProfileBtn')?.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  toggleProfileMenu(event.currentTarget);
});
$('#nodeProfileBtn')?.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (event.detail === 0) toggleProfileMenu(event.currentTarget);
});
$('#quickRestartBtn').onclick = (event) => runButtonAction(event.currentTarget, '重启中...', restartCoreJob);
$('#lockAutoGroupBtn')?.addEventListener('click', (event) => runButtonAction(event.currentTarget, '锁定中...', lockAutoGroupJob));
$('#refreshConnectionsBtn').onclick = refreshConnections;
$('#closeAllConnectionsBtn').onclick = (event) => runButtonAction(event.currentTarget, '关闭中...', () => runOptimisticAction({
  apply: () => { replaceChildrenSafe($('#connectionRows'), [emptyState('\u5f53\u524d\u6ca1\u6709\u6d3b\u52a8\u8fde\u63a5\u3002')]); },
  commit: () => invoke('close_connections'),
  refresh: () => refreshConnections(),
  rollback: () => refreshConnections(),
  pendingNotice: '已清空连接列表，正在后台关闭连接...',
  successNotice: '连接已关闭。',
  failureNotice: (err) => `关闭连接失败：${err.message || err}`
}));
$('#runDiagBtn').onclick = (event) => runDetachedButtonAction(event.currentTarget, '诊断中...', () => runDiagnostics());
const copyDiagBtn = $('#copyDiagBtn');
if (copyDiagBtn) copyDiagBtn.onclick = (event) => runButtonAction(event.currentTarget, '复制中...', async () => {
  if (!latestDiagnostics) await runDiagnostics(false);
  const report = diagnosticReportText(latestDiagnostics);
  await navigator.clipboard?.writeText(report);
  setNotice('诊断报告已复制。');
});
const exportLogsBtn = $('#exportLogsBtn');
if (exportLogsBtn) exportLogsBtn.onclick = (event) => runButtonAction(event.currentTarget, '导出中...', exportLogs);
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
if (batchTestBtn) batchTestBtn.onclick = (event) => testNodes(event.currentTarget);
const nodeSearch = $('#nodeSearch');
if (nodeSearch) nodeSearch.oninput = () => {
  nodeSearchKeyword = nodeSearch.value.trim().toLowerCase();
  scheduleRowsRender(latestGroup?.items || [], { force: true, target: 'nodes' });
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
    uiStore.set({ homeNodeMode: 'region', homeRegionFilter: nextRegion });
    scheduleRowsRender(latestGroup?.items || [], { force: true, target: 'home', delay: 0 });
    if (isSpeedTestActive()) queueNodeRefresh('home', speedTestPollMs);
    setNotice(nextRegion ? `已在首页筛选地区：${button.textContent.trim()}` : '已取消地区筛选。');
  };
});

$all('[data-home-mode]').forEach((button) => {
  button.onclick = () => {
    const mode = button.dataset.homeMode || 'frequent';
    uiStore.set({ homeNodeMode: mode, homeRegionFilter: mode === 'region' ? (uiStore.state.homeRegionFilter || 'HK') : '' });
    scheduleRowsRender(latestGroup?.items || [], { force: true, target: 'home', delay: 0 });
    if (isSpeedTestActive()) queueNodeRefresh('home', speedTestPollMs);
  };
});

$all('[data-node-filter]').forEach((button) => {
  button.onclick = () => {
    uiStore.set({ nodePageFilter: button.dataset.nodeFilter || 'all' });
    scheduleRowsRender(latestGroup?.items || [], { force: true, target: 'nodes', delay: 0 });
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

$('#addFixedNodeBtn')?.addEventListener('click', () => openNodeEditor(''));
$('#nodeEditorForm')?.addEventListener('submit', saveNodeEditor);
$('#cancelNodeEditorBtn')?.addEventListener('click', closeNodeEditor);
$('#closeNodeEditorBtn')?.addEventListener('click', closeNodeEditor);
$('#nodeEditorOverlay')?.addEventListener('click', (event) => {
  if (event.target.id === 'nodeEditorOverlay') closeNodeEditor();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#nodeEditorOverlay')?.classList.contains('hidden')) {
    closeNodeEditor();
  }
});

window.addEventListener('resize', positionQuickProfileMenu);

$('#nodeRows').addEventListener('click', (event) => {
  const actionButton = event.target.closest('[data-node-action]');
  if (actionButton) {
    event.preventDefault();
    event.stopPropagation();
    const name = actionButton.dataset.node;
    if (actionButton.dataset.nodeAction === 'test') testSingleNode(name, actionButton);
    if (actionButton.dataset.nodeAction === 'edit') openNodeEditor(name);
    if (actionButton.dataset.nodeAction === 'favorite') toggleFavoriteNode(name);
    return;
  }
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
  try {
    if (!event.target.closest('.mode-box')) {
      $('#modeMenu')?.classList.add('hidden');
    }
    if (!event.target.closest('#profileMenu') && !event.target.closest('#quickProfileBtn') && !event.target.closest('#nodeProfileBtn')) {
      $('#profileMenu')?.classList.add('hidden');
      profileMenuAnchor = null;
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
      $('#profileMenu')?.classList.add('hidden');
      profileMenuAnchor = null;
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
    const profileRename = event.target.closest('[data-profile-rename]')?.dataset.profileRename;
    if (profileRename) {
      const profile = (latestStatus?.settings?.profiles || []).find((item) => item.id === profileRename);
      const nextName = window.prompt('\u8f93\u5165\u65b0\u8ba2\u9605\u540d\u79f0', profile?.name || '');
      if (nextName == null) return;
      const trimmed = nextName.trim();
      if (!trimmed) {
        setNotice('\u8ba2\u9605\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a\u3002');
        return;
      }
      await runOptimisticAction({
        apply: () => optimisticProfilePatch(profileRename, { name: trimmed }),
        commit: async () => {
          const result = await renameProfileJob(profileRename, trimmed);
          if (!result) throw new Error(lastBackgroundJobError || 'profile rename failed');
          return result;
        },
        refresh: async () => {
          await refreshStatus(true);
          renderProfiles();
        },
        pendingNotice: '\u8ba2\u9605\u540d\u79f0\u5df2\u66f4\u65b0\uff0c\u6b63\u5728\u540e\u53f0\u4fdd\u5b58...',
        successNotice: '\u8ba2\u9605\u5df2\u91cd\u547d\u540d\u3002',
        failureNotice: (err) => `\u8ba2\u9605\u91cd\u547d\u540d\u5931\u8d25\uff1a${err.message || err}`
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
initializeAppData().catch(() => {
  refreshStatus(true);
  refreshNodes();
});
tick();
setInterval(tick, 1000);
setInterval(() => syncJobCenter(false), 2500);
setInterval(() => refreshActiveConnectionCount(false), 5000);
setInterval(refreshStatus, 8000);
setInterval(maybeAutoRecover, 60000);
