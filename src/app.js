const fallbackNodes = [
  ['HK', '香港直连测试', 'hk.aegos.local'],
  ['JP', '日本直连测试', 'jp.aegos.local'],
  ['SG', '新加坡测试', 'sg.aegos.local'],
  ['TW', '台湾低负载', 'tw.aegos.local'],
  ['US', '美国测试', 'us.aegos.local'],
  ['GB', '英国测试', 'gb.aegos.local']
];

const pageNames = {
  home: '首页',
  nodes: '节点',
  connections: '连接',
  routing: '规则',
  profiles: '订阅',
  diagnostics: '诊断',
  logs: '日志',
  settings: '设置'
};

pageNames.home = '\u9996\u9875';
pageNames.nodes = '\u8282\u70b9';
pageNames.connections = '\u8fde\u63a5';
pageNames.routing = '\u89c4\u5219';
pageNames.profiles = '\u8ba2\u9605';
pageNames.diagnostics = '\u8bca\u65ad';
pageNames.logs = '\u65e5\u5fd7';
pageNames.settings = '\u8bbe\u7f6e';

let latestStatus = null;
let latestGroups = [];
let latestGroup = null;
let selectedProxyGroupName = '';
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
let nodeSortState = { key: '', direction: 0 };
let logFilter = 'all';
let speedTestTimer = null;
let speedTestStarting = false;
let activeSpeedRunId = 0;
let profileStateSeq = 0;
let profilePreviewSeq = 0;
let profileMenuAnchor = null;
let nodeTransitionTimer = null;
let routingAssistantReady = false;
let latestRoutingSnapshot = null;
let latestEnvironmentReadiness = null;
let environmentReadinessBusy = false;
let ipv6DnsSafetyBusy = false;
let routingAssistantDrafts = [];
let routingAssistantView = 'simple';
let routingAssistantKind = 'website';
let routingSummaryDetail = 'user';
let expandedRoutingDraftId = '';
let routingApplyStatus = null;
let routingRuleEditRaw = '';
let nodeGroupSortMode = false;
let nodeGroupDragName = '';
let nodeGroupDraftOrder = [];
let nodeGroupOrderOverrides = readLocalJson('aegos.nodeGroupOrderOverrides', {});
let nodeGroupContextName = '';
let nodeGroupMemberEditorState = null;
let nodeGroupTargetEditorState = null;
const speedTestButtons = new Set();
let lastSpeedNodeRefreshAt = 0;
let latestSpeedStatus = null;
let lastAppliedSpeedSignature = '';
let latestRecommendedName = '';
let outboundIpRequestSeq = 0;
let outboundIpPendingSeq = 0;
let outboundIpLastStable = '-';
let corePowerPendingKind = '';
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
let latestIpv6DnsSafety = null;
let jobCenterSyncBusy = false;
let jobCenterLastSyncAt = 0;
let activeConnectionCount = 0;
let activeConnectionBusy = false;
let lastActiveConnectionAt = 0;
let queuedNodeRefresh = null;
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

const STATUS_TEXT = Object.freeze({
  enabled: '\u5df2\u5f00\u542f',
  disabled: '\u672a\u5f00\u542f',
  pending: '\u5f85\u751f\u6548',
  pendingConnection: '\u5f85\u8fde\u63a5',
  connected: '\u5df2\u8fde\u63a5',
  disconnected: '\u672a\u8fde\u63a5',
  coreStandby: '\u6838\u5fc3\u5f85\u547d',
  coreStopped: '\u672a\u8fd0\u884c',
  takeoverActive: '\u5df2\u63a5\u7ba1',
  takeoverInactive: '\u672a\u63a5\u7ba1',
  savedSnapshot: '\u5df2\u4fdd\u5b58\u539f\u72b6\u6001',
  admin: '\u7ba1\u7406\u5458',
  normalPermission: '\u666e\u901a\u6743\u9650',
  unchecked: '\u672a\u68c0\u67e5',
  ok: '\u6b63\u5e38',
  warn: '\u8b66\u544a',
  error: '\u9519\u8bef',
  available: '\u53ef\u7528',
  unavailable: '\u4e0d\u53ef\u7528',
  stale: '\u9700\u5237\u65b0',
  checking: '\u68c0\u6d4b\u4e2d',
  unknownError: '\u672a\u77e5\u9519\u8bef'
});

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

function enabledLabel(value) {
  return value ? STATUS_TEXT.enabled : STATUS_TEXT.disabled;
}

function systemProxyUiLabel(applied, wanted) {
  if (applied) return STATUS_TEXT.enabled;
  return wanted ? STATUS_TEXT.pendingConnection : STATUS_TEXT.disabled;
}

function runtimeSummaryLabel(status = {}, settings = {}) {
  if (status.trafficTakeover) {
    if (settings.tunEnabled) return 'TUN \u63a5\u7ba1';
    if (settings.systemProxy) return '\u7cfb\u7edf\u4ee3\u7406\u63a5\u7ba1';
    return STATUS_TEXT.takeoverActive;
  }
  return status.coreReady ? STATUS_TEXT.coreStandby : STATUS_TEXT.coreStopped;
}

function connectionButtonLabel(status = {}, pendingKind = corePowerPendingKind) {
  if (pendingKind === 'startCore') return '\u8fde\u63a5\u4e2d';
  if (pendingKind === 'stopCore') return '\u65ad\u5f00\u4e2d';
  return status.trafficTakeover ? '\u65ad\u5f00\u8fde\u63a5' : '\u8fde\u63a5';
}

function networkAvailabilityInfo(status = {}) {
  const availability = status.network?.availability || {};
  const state = availability.state || 'unverified';
  const labelMap = {
    available: STATUS_TEXT.available,
    unavailable: STATUS_TEXT.unavailable,
    stale: STATUS_TEXT.stale,
    checking: STATUS_TEXT.checking,
    unverified: STATUS_TEXT.unchecked
  };
  const classMap = {
    available: 'ok',
    stale: 'warn',
    checking: 'warn',
    unavailable: 'bad',
    unverified: ''
  };
  return {
    state,
    label: availability.label || labelMap[state] || STATUS_TEXT.unchecked,
    detail: availability.detail || '',
    className: classMap[state] || ''
  };
}

function statusSurfaceNotice(status = {}, settings = {}, protection = {}, availability = networkAvailabilityInfo(status)) {
  const coreReady = Boolean(status.coreReady ?? status.running);
  const trafficTakeover = Boolean(status.trafficTakeover || settings.proxyTakeover?.active);
  const connection = status.connection || {};
  const systemProxyWanted = Boolean(connection.systemProxyWanted ?? settings.systemProxy);
  const systemProxyApplied = Boolean(connection.systemProxyApplied ?? (trafficTakeover && Boolean(settings.systemProxy)));
  const protectionLabel = protection.label || STATUS_TEXT.disabled;

  if (!coreReady) {
    return `${protectionLabel}\uff1a\u6838\u5fc3\u672a\u8fd0\u884c\uff0c\u5f53\u524d\u6ca1\u6709\u6d41\u91cf\u63a5\u7ba1\u3002`;
  }
  if (!trafficTakeover) {
    return `${protectionLabel}\uff1a\u6838\u5fc3\u5f85\u547d\uff0c\u8fd8\u672a\u63a5\u7ba1\u7cfb\u7edf\u6d41\u91cf\u3002`;
  }
  if (systemProxyWanted && !systemProxyApplied) {
    return `${protectionLabel}\uff1a\u7cfb\u7edf\u4ee3\u7406\u5f85\u751f\u6548\uff0c\u8bf7\u4f7f\u7528\u8bca\u65ad\u68c0\u67e5\u7aef\u53e3\u548c Windows \u4ee3\u7406\u72b6\u6001\u3002`;
  }
  if (availability.state === 'available') {
    return `${protectionLabel}\uff1a\u5df2\u63a5\u7ba1\u6d41\u91cf\uff0c\u7f51\u7edc\u53ef\u7528\u6027\u5df2\u9a8c\u8bc1\u3002`;
  }
  if (availability.state === 'stale') {
    return `${protectionLabel}\uff1a\u5df2\u63a5\u7ba1\u6d41\u91cf\uff0c\u843d\u5730 IP \u4e3a\u65e7\u7ed3\u679c\uff0c\u5efa\u8bae\u5237\u65b0\u72b6\u6001\u3002`;
  }
  if (availability.state === 'checking') {
    return `${protectionLabel}\uff1a\u5df2\u63a5\u7ba1\u6d41\u91cf\uff0c\u6b63\u5728\u9a8c\u8bc1\u5f53\u524d\u7f51\u7edc\u3002`;
  }
  if (availability.state === 'unavailable') {
    return `${protectionLabel}\uff1a\u5df2\u63a5\u7ba1\u6d41\u91cf\uff0c\u4f46\u6700\u8fd1\u4e00\u6b21\u843d\u5730 IP \u67e5\u8be2\u5931\u8d25\u3002`;
  }
  return `${protectionLabel}\uff1a\u5df2\u63a5\u7ba1\u6d41\u91cf\uff0c\u7f51\u7edc\u72b6\u6001\u5c1a\u672a\u9a8c\u8bc1\u3002`;
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
const largeNodeScanLimit = 120;
const eagerNodeIndexLimit = 360;
const logRenderLimit = 80;
const nodeInitialRenderLimit = 36;
const nodeRenderLimit = 96;
const interactiveNodeRenderLimit = 24;
const interactiveNodeCandidateLimit = 48;
const homeNodeRenderLimit = 8;
const pageNavSettleMs = 550;
const foregroundQuietMs = 1800;
const freezeWarnMs = 500;
const freezeBadMs = 1500;
const pageCacheTtlMs = {
  connections: 15000,
  routing: 15000,
  diagnostics: 30000,
  profiles: 15000,
  logs: 5000,
  settings: 30000
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
  routing: { loaded: false, loading: false, updatedAt: 0 },
  diagnostics: { loaded: false, loading: false, updatedAt: 0 },
  profiles: { loaded: false, loading: false, updatedAt: 0 },
  logs: { loaded: false, loading: false, updatedAt: 0 },
  settings: { loaded: false, loading: false, updatedAt: 0 }
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

let appDialogResolve = null;

function closeAppDialog(result = null) {
  const overlay = $('#appDialogOverlay');
  if (overlay) overlay.classList.add('hidden');
  if (appDialogResolve) {
    const resolve = appDialogResolve;
    appDialogResolve = null;
    resolve(result);
  }
}

function ensureAppDialog() {
  if ($('#appDialogOverlay')) return;
  const overlay = el('div', {
    id: 'appDialogOverlay',
    className: 'app-dialog-overlay hidden',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'appDialogTitle' }
  }, [
    el('form', { id: 'appDialogForm', className: 'app-dialog' }, [
      el('header', {}, [
        el('div', {}, [
          el('h3', { id: 'appDialogTitle', textContent: '确认操作' }),
          el('p', { id: 'appDialogMessage', textContent: '' })
        ]),
        el('button', { id: 'appDialogCloseBtn', className: 'icon-button', attrs: { type: 'button', 'aria-label': '关闭' } }, [text('')])
      ]),
      el('label', { id: 'appDialogInputRow', className: 'app-dialog-input hidden' }, [
        el('span', { id: 'appDialogInputLabel', textContent: '' }),
        el('input', { id: 'appDialogInput', attrs: { autocomplete: 'off', spellcheck: 'false' } }),
        el('small', { id: 'appDialogHint', textContent: '' })
      ]),
      el('footer', {}, [
        el('button', { id: 'appDialogCancelBtn', className: 'ghost compact', attrs: { type: 'button' }, textContent: '取消' }),
        el('button', { id: 'appDialogOkBtn', className: 'primary compact', attrs: { type: 'submit' }, textContent: '确定' })
      ])
    ])
  ]);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.closest('#appDialogCloseBtn') || event.target.closest('#appDialogCancelBtn')) {
      closeAppDialog(null);
    }
  });
  overlay.querySelector('#appDialogForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('#appDialogInput');
    closeAppDialog(input && !$('#appDialogInputRow')?.classList.contains('hidden') ? input.value : true);
  });
  document.body.append(overlay);
}

function requestAppInput(options = {}) {
  ensureAppDialog();
  const overlay = $('#appDialogOverlay');
  if (appDialogResolve) closeAppDialog(null);
  $('#appDialogTitle').textContent = options.title || '';
  $('#appDialogMessage').textContent = options.message || '';
  $('#appDialogInputLabel').textContent = options.label || '';
  $('#appDialogInput').value = options.value || '';
  $('#appDialogInput').placeholder = options.placeholder || '';
  $('#appDialogHint').textContent = options.hint || '';
  $('#appDialogOkBtn').textContent = options.okText || '确定';
  $('#appDialogOkBtn').classList.remove('danger');
  $('#appDialogCancelBtn').textContent = options.cancelText || '取消';
  $('#appDialogInputRow').classList.remove('hidden');
  overlay.classList.remove('hidden');
  runWhenIdle(() => {
    const input = $('#appDialogInput');
    input?.focus?.();
    input?.select?.();
  });
  return new Promise((resolve) => {
    appDialogResolve = resolve;
  });
}

function requestAppConfirm(options = {}) {
  ensureAppDialog();
  const overlay = $('#appDialogOverlay');
  if (appDialogResolve) closeAppDialog(null);
  $('#appDialogTitle').textContent = options.title || '确认操作';
  $('#appDialogMessage').textContent = options.message || '';
  $('#appDialogHint').textContent = '';
  $('#appDialogOkBtn').textContent = options.okText || '确定';
  $('#appDialogCancelBtn').textContent = options.cancelText || '取消';
  $('#appDialogInputRow').classList.add('hidden');
  $('#appDialogOkBtn').classList.toggle('danger', Boolean(options.danger));
  overlay.classList.remove('hidden');
  runWhenIdle(() => $('#appDialogOkBtn')?.focus?.());
  return new Promise((resolve) => {
    appDialogResolve = (value) => resolve(Boolean(value));
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
  renderNodeGroupSwitcher();
}

function groupNameKey(name = '') {
  return String(name || '').trim().toLowerCase();
}

function isGlobalGroup(group = {}) {
  return groupNameKey(group.name) === 'global';
}

function isProxiesGroup(group = {}) {
  const key = groupNameKey(group.name);
  return key === 'proxies' || key === 'proxy';
}

function isAutoSelectGroup(group = {}) {
  const key = groupNameKey(group.name);
  return Boolean(group.syntheticAuto
    || key === '自动选择'
    || key === 'auto select'
    || key === 'auto-select'
    || key === 'url-test'
    || key === 'urltest'
    || key === 'auto');
}

function isGlobalMode() {
  return latestStatus?.mode === 'global';
}

function activeProfileStorageKey() {
  return latestStatus?.settings?.activeProfileId || latestStatus?.activeProfile?.id || 'default';
}

function saveNodeGroupOrderOverrides() {
  localStorage.setItem('aegos.nodeGroupOrderOverrides', JSON.stringify(nodeGroupOrderOverrides));
}

function nodeGroupOrderForCurrentProfile() {
  if (nodeGroupSortMode && nodeGroupDraftOrder.length) return nodeGroupDraftOrder;
  const order = nodeGroupOrderOverrides[activeProfileStorageKey()];
  return Array.isArray(order) ? order : [];
}

function rawGroupName(group = {}) {
  return String(group?.backendGroupName || group?.name || '').trim();
}

function proxyGroupLookup(groups = []) {
  const map = new Map();
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    const name = rawGroupName(group);
    if (name) map.set(name, group);
  });
  return map;
}

function itemGroupReferenceName(item = {}, groupMap = proxyGroupLookup(latestGroups)) {
  const name = String(item?.realProxyName || item?.name || '').trim();
  if (!name || !groupMap.has(name)) return '';
  return name;
}

function resolveGroupRealItems(group = {}, groups = latestGroups, options = {}) {
  const groupMap = proxyGroupLookup(groups);
  const rootName = rawGroupName(group);
  const backendGroupName = options.backendGroupName || rootName;
  const seenNodes = options.seenNodes || new Set();
  const stack = options.stack || [];
  const result = [];
  const currentName = rootName || String(group?.name || '').trim();
  if (currentName && stack.includes(currentName)) return result;
  const nextStack = currentName ? [...stack, currentName] : stack;

  (Array.isArray(group?.items) ? group.items : []).forEach((item) => {
    const referencedGroupName = itemGroupReferenceName(item, groupMap);
    if (referencedGroupName) {
      result.push(...resolveGroupRealItems(groupMap.get(referencedGroupName), groups, {
        backendGroupName,
        seenNodes,
        stack: nextStack
      }));
      return;
    }
    const name = item?.realProxyName || item?.name || '';
    if (!name || seenNodes.has(name) || !isRealProxyNodeItem(item)) return;
    seenNodes.add(name);
    result.push({ ...item, backendGroupName });
  });
  return result;
}

function expandedNodeGroup(group = {}, groups = latestGroups) {
  const backendGroupName = rawGroupName(group);
  const resolvedItems = resolveGroupRealItems(group, groups, { backendGroupName });
  const directItems = Array.isArray(group?.items) ? group.items : [];
  const sourceNames = directItems
    .map((item) => itemGroupReferenceName(item, proxyGroupLookup(groups)) || String(item?.name || '').trim())
    .filter(Boolean);
  return {
    ...group,
    backendGroupName,
    sourceNames,
    resolvedNodeCount: resolvedItems.length,
    items: resolvedItems.length ? resolvedItems : directItems.map((item) => isRealProxyNodeItem(item) ? { ...item, backendGroupName } : item)
  };
}

function allRealProxyItemsFromGroups(groups = []) {
  const seen = new Set();
  const result = [];
  const orderedGroups = [...groups].sort((a, b) => {
    const rank = (group) => isProxiesGroup(group) ? 0 : isGlobalGroup(group) ? 2 : 1;
    return rank(a) - rank(b);
  });
  orderedGroups.forEach((group) => {
    const groupName = group?.backendGroupName || group?.name || '';
    resolveGroupRealItems(group, groups, { backendGroupName: groupName }).forEach((item) => {
      const name = item?.realProxyName || item?.name || '';
      if (!name || seen.has(name) || !isRealProxyNodeItem(item)) return;
      seen.add(name);
      result.push({ ...item, backendGroupName: item.backendGroupName || groupName });
    });
  });
  return result;
}

function allNodeViewGroup(baseGroup = {}, allItems = []) {
  if (!baseGroup || !allItems.length) return baseGroup;
  const baseBackendGroup = baseGroup.backendGroupName || baseGroup.name || '';
  const currentRealCount = nodeGroupStats(baseGroup).realNodes;
  if (currentRealCount >= allItems.length) {
    return {
      ...baseGroup,
      backendGroupName: baseBackendGroup,
      items: (baseGroup.items || []).map((item) => isRealProxyNodeItem(item) ? { ...item, backendGroupName: baseBackendGroup } : item)
    };
  }
  return {
    ...baseGroup,
    backendGroupName: baseBackendGroup,
    items: allItems.map((item) => isRealProxyNodeItem(item) ? { ...item, backendGroupName: baseBackendGroup } : item)
  };
}

function primaryManualGroup(groups = []) {
  return groups.find(isProxiesGroup)
    || groups.find((group) => !isGlobalGroup(group) && !isAutoSelectGroup(group) && nodeGroupStats(group).realNodes > 0)
    || groups.find(isGlobalGroup)
    || groups[0]
    || null;
}

function autoSelectScore(item = {}) {
  const delay = Number(item.delay ?? -1);
  const healthScore = Number(item.healthScore ?? 999999);
  const jitter = Number(item.jitter ?? 0);
  const failureStreak = Number(item.failureStreak ?? 0);
  const testedPenalty = Number(item.lastTestedAt ?? 0) > 0 ? 0 : 180;
  const cooldownPenalty = item.healthStatus === 'cooldown' ? 5000 : 0;
  const failurePenalty = delay < 0 || item.alive === false ? 4000 : 0;
  const latency = delay > 0 ? delay : 2500;
  return failurePenalty + cooldownPenalty + latency + Math.max(0, healthScore) * 0.08 + jitter * 0.4 + failureStreak * 160 + testedPenalty;
}

function createAutoSelectGroup(groups = []) {
  if ((Array.isArray(groups) ? groups : []).some(isAutoSelectGroup)) return null;
  const sourceGroup = primaryManualGroup(groups);
  const allItems = allRealProxyItemsFromGroups(groups);
  if (!sourceGroup || allItems.length < 2) return null;
  const items = [...allItems].sort((a, b) => autoSelectScore(a) - autoSelectScore(b)
    || String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'));
  const now = items.find((item) => Number(item.delay ?? -1) > 0 && item.alive !== false)?.name || sourceGroup.now || items[0]?.name || '';
  return {
    name: '自动选择',
    type: 'url-test',
    now,
    syntheticAuto: true,
    backendGroupName: sourceGroup.name || '',
    items
  };
}

function normalizeNodeGroups(groups = []) {
  const source = Array.isArray(groups) ? groups.filter((group) => Array.isArray(group?.items) && group.items.length) : [];
  const allItems = allRealProxyItemsFromGroups(source);
  const autoGroup = createAutoSelectGroup(source);
  const visible = source
    .filter((group) => !isGlobalGroup(group))
    .map((group) => expandedNodeGroup(isProxiesGroup(group) ? allNodeViewGroup(group, allItems) : group, source));
  const used = new Set();
  const ordered = [];
  const pushGroup = (group) => {
    if (!group?.name) return;
    const key = `${group.syntheticAuto ? 'synthetic' : 'real'}:${group.name}`;
    if (used.has(key)) return;
    used.add(key);
    ordered.push(group);
  };
  visible.filter(isProxiesGroup).forEach(pushGroup);
  visible.filter(isAutoSelectGroup).forEach(pushGroup);
  if (autoGroup && !visible.some(isAutoSelectGroup)) pushGroup(autoGroup);
  visible
    .filter((group) => !isProxiesGroup(group) && !isGlobalGroup(group) && !isAutoSelectGroup(group))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'))
    .forEach(pushGroup);
  const finalGroups = ordered.length ? ordered : visible;
  const profileOrder = nodeGroupOrderForCurrentProfile();
  if (!Array.isArray(profileOrder) || !profileOrder.length) return finalGroups;
  const indexOf = (name) => {
    const index = profileOrder.indexOf(name);
    return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
  };
  return [...finalGroups].sort((a, b) => {
    return indexOf(a.name) - indexOf(b.name)
      || finalGroups.indexOf(a) - finalGroups.indexOf(b);
  });
}

function preferredProxyGroup(groups = latestGroups, preferredName = selectedProxyGroupName) {
  const list = normalizeNodeGroups(groups);
  if (!list.length) return null;
  return list.find((group) => group.name === preferredName)
    || list.find(isProxiesGroup)
    || list.find(isAutoSelectGroup)
    || list.find((group) => /proxy|select|selector/i.test(`${group.name || ''} ${group.type || ''}`))
    || list[0];
}

function setLatestGroups(groups = [], preferredName = selectedProxyGroupName) {
  latestGroups = Array.isArray(groups) ? groups : [];
  const group = preferredProxyGroup(latestGroups, preferredName);
  selectedProxyGroupName = group?.name || '';
  setLatestGroup(group);
}

function reconcileVisibleProxyGroup() {
  if (!latestGroups.length) return;
  const visibleGroups = normalizeNodeGroups(latestGroups);
  if (!visibleGroups.length) return;
  if (latestGroup && visibleGroups.some((group) => group.name === latestGroup.name)) return;
  const group = preferredProxyGroup(latestGroups, selectedProxyGroupName);
  selectedProxyGroupName = group?.name || '';
  setLatestGroup(group);
}

function nodeGroupSummary(group = {}) {
  const stats = nodeGroupStats(group);
  const typeLabel = routingStrategyTypeLabel(group.type || 'Selector').replace('\u9009\u62e9', '');
  const count = Number(group.resolvedNodeCount ?? stats.realNodes);
  const active = group.name === latestGroup?.name;
  const currentIp = active && outboundIpLastStable && outboundIpLastStable !== '-' ? outboundIpLastStable : '';
  const selected = currentIp || group.now || '-';
  return `${typeLabel} / ${count} \u8282\u70b9 / ${selected}`;
}

function nodeGroupTitle(group = {}) {
  const stats = nodeGroupStats(group);
  const selected = group.now || '-';
  const count = Number(group.resolvedNodeCount ?? stats.realNodes);
  const source = Array.isArray(group.sourceNames) && group.sourceNames.length ? `\uff0c\u6210\u5458 ${group.sourceNames.join(', ')}` : '';
  return `${group.name || 'GLOBAL'}: ${count} \u4e2a\u53ef\u7528\u8282\u70b9\uff0c${stats.policyOptions} \u4e2a\u7b56\u7565/\u5185\u7f6e\u9009\u9879\uff0c\u5f53\u524d ${selected}${source}`;
}

function ensureNodeGroupSwitcher() {
  const panel = document.querySelector('[data-page-panel="nodes"] .nodes');
  if (!panel || $('#nodeGroupStrip')) return;
  const tableHead = panel.querySelector('.table-head');
  if (!tableHead) return;
  const sortBar = el('div', { id: 'nodeGroupSortBar', className: 'node-group-sort-bar hidden' }, [
    el('span', { textContent: '\u62d6\u52a8\u7b56\u7565\u7ec4\u8c03\u6574\u987a\u5e8f' }),
    el('button', { className: 'primary compact', dataset: { nodeGroupSortDone: '1' }, attrs: { type: 'button' }, textContent: '\u5b8c\u6210' }),
    el('button', { className: 'ghost compact', dataset: { nodeGroupSortCancel: '1' }, attrs: { type: 'button' }, textContent: '\u53d6\u6d88' })
  ]);
  const strip = el('section', { id: 'nodeGroupStrip', className: 'node-group-strip', attrs: { 'aria-label': '\u7b56\u7565\u7ec4' } }, []);
  strip.addEventListener('wheel', handleNodeGroupWheel, { passive: false });
  strip.addEventListener('click', (event) => {
    const button = event.target.closest('[data-node-group]');
    if (!button) return;
    if (nodeGroupSortMode) return;
    selectProxyGroup(button.dataset.nodeGroup || '');
  });
  strip.addEventListener('contextmenu', openNodeGroupContextMenu);
  strip.addEventListener('dragstart', handleNodeGroupDragStart);
  strip.addEventListener('dragover', handleNodeGroupDragOver);
  strip.addEventListener('drop', handleNodeGroupDrop);
  strip.addEventListener('dragend', () => { nodeGroupDragName = ''; });
  strip.addEventListener('pointerdown', handleNodeGroupPointerDown);
  strip.addEventListener('pointerup', handleNodeGroupPointerUp);
  sortBar.addEventListener('click', (event) => {
    if (event.target.closest('[data-node-group-sort-done]')) finishNodeGroupSort(true);
    if (event.target.closest('[data-node-group-sort-cancel]')) finishNodeGroupSort(false);
  });
  tableHead.after(sortBar, strip);
  ensureNodeGroupContextMenu();
  ensureNodeGroupMemberEditor();
}

function handleNodeGroupWheel(event) {
  const strip = event.currentTarget;
  if (!strip || strip.scrollWidth <= strip.clientWidth + 1) return;
  const primaryDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!primaryDelta) return;
  event.preventDefault();
  strip.scrollLeft += primaryDelta;
}

function rawNodeGroupForName(name = '') {
  return (latestGroups || []).find((group) => String(group?.name || '') === String(name || '')) || null;
}

function directMemberNamesForGroup(name = '') {
  const group = rawNodeGroupForName(name);
  return (Array.isArray(group?.items) ? group.items : [])
    .map((item) => String(item?.realProxyName || item?.name || '').trim())
    .filter(Boolean);
}

function editableMemberNamesForGroup(name = '') {
  const raw = rawNodeGroupForName(name);
  if (!raw) return [];
  const direct = directMemberNamesForGroup(name);
  const groupMap = proxyGroupLookup(latestGroups);
  if (direct.some((item) => groupMap.has(item))) {
    return resolveGroupRealItems(raw, latestGroups, { backendGroupName: name }).map((item) => item.name).filter(Boolean);
  }
  return direct;
}

function ensureNodeGroupContextMenu() {
  if ($('#nodeGroupContextMenu')) return;
  const menu = el('div', { id: 'nodeGroupContextMenu', className: 'node-group-context-menu hidden' }, []);
  document.body.append(menu);
}

function ensureNodeGroupMemberEditor() {
  if ($('#nodeGroupMemberEditor')) return;
  const overlay = el('div', { id: 'nodeGroupMemberEditor', className: 'node-member-editor hidden' }, [
    el('section', { className: 'node-member-panel' }, [
      el('header', { className: 'node-member-head' }, [
        el('div', {}, [
          el('b', { id: 'nodeMemberTitle', textContent: '\u9009\u62e9\u53ef\u7528\u8282\u70b9' }),
          el('small', { id: 'nodeMemberHint', textContent: '\u4ece\u5f53\u524d\u8ba2\u9605\u9009\u62e9\u8282\u70b9\uff0c\u4e5f\u53ef\u6309\u56fd\u5bb6/\u5730\u533a\u6279\u91cf\u5bfc\u5165\u3002' })
        ]),
        el('button', { className: 'ghost compact', dataset: { closeNodeMemberEditor: '1' }, attrs: { type: 'button' }, textContent: '\u5173\u95ed' })
      ]),
      el('div', { id: 'nodeMemberRegions', className: 'node-member-regions' }),
      el('div', { className: 'node-member-tools' }, [
        el('button', { className: 'ghost compact', dataset: { selectVisibleNodeMembers: '1' }, attrs: { type: 'button' }, textContent: '\u9009\u4e2d\u5f53\u524d\u5730\u533a' }),
        el('button', { className: 'ghost compact', dataset: { selectAllNodeMembers: '1' }, attrs: { type: 'button' }, textContent: '\u5168\u9009' }),
        el('button', { className: 'ghost compact', dataset: { clearNodeMembers: '1' }, attrs: { type: 'button' }, textContent: '\u6e05\u7a7a' }),
        el('span', { id: 'nodeMemberCount', textContent: '0 / 0' })
      ]),
      el('div', { id: 'nodeMemberList', className: 'node-member-list' }),
      el('footer', { className: 'node-member-actions' }, [
        el('button', { className: 'ghost compact', dataset: { closeNodeMemberEditor: '1' }, attrs: { type: 'button' }, textContent: '\u53d6\u6d88' }),
        el('button', { className: 'primary compact', dataset: { saveNodeMembers: '1' }, attrs: { type: 'button' }, textContent: '\u4fdd\u5b58' })
      ])
    ])
  ]);
  overlay.addEventListener('click', handleNodeMemberEditorClick);
  document.body.append(overlay);
}

function ensureNodeGroupTargetEditor() {
  if ($('#nodeGroupTargetEditor')) return;
  const overlay = el('div', { id: 'nodeGroupTargetEditor', className: 'node-member-editor hidden' }, [
    el('section', { className: 'node-member-panel node-target-panel' }, [
      el('header', { className: 'node-member-head' }, [
        el('div', {}, [
          el('b', { id: 'nodeTargetTitle', textContent: '编辑目标网站' }),
          el('small', { id: 'nodeTargetHint', textContent: '把网站固定到这个策略组，不影响当前连接。' })
        ]),
        el('button', { className: 'ghost compact', dataset: { closeNodeTargetEditor: '1' }, attrs: { type: 'button' }, textContent: '关闭' })
      ]),
      el('div', { id: 'nodeTargetSummary', className: 'node-target-summary' }),
      el('div', { className: 'node-target-add' }, [
        el('label', { className: 'routing-field' }, [
          el('span', { textContent: '匹配方式' }),
          el('select', { id: 'nodeTargetKindSelect' }, [
            el('option', { textContent: '网站后缀：example.com 及子域名', attrs: { value: 'DOMAIN-SUFFIX' } }),
            el('option', { textContent: '完整域名：只匹配一个域名', attrs: { value: 'DOMAIN' } }),
            el('option', { textContent: '关键词：域名包含关键词', attrs: { value: 'DOMAIN-KEYWORD' } })
          ])
        ]),
        el('label', { className: 'routing-field' }, [
          el('span', { textContent: '目标网站' }),
          el('input', { id: 'nodeTargetConditionInput', attrs: { placeholder: '例如 bilibili.com', autocomplete: 'off', spellcheck: 'false' } })
        ]),
        el('button', { className: 'primary compact', dataset: { addNodeTargetRule: '1' }, attrs: { type: 'button' }, textContent: '添加' }),
        el('div', { className: 'node-target-examples' }, [
          el('small', { id: 'nodeTargetInputHint', textContent: '输入后 Aegos 会立即检查重复和冲突。' }),
          el('button', { className: 'ghost compact', dataset: { nodeTargetExample: 'youtube.com', nodeTargetKind: 'DOMAIN-SUFFIX' }, attrs: { type: 'button' }, textContent: 'youtube.com' }),
          el('button', { className: 'ghost compact', dataset: { nodeTargetExample: 'telegram', nodeTargetKind: 'DOMAIN-KEYWORD' }, attrs: { type: 'button' }, textContent: 'telegram' }),
          el('button', { className: 'ghost compact', dataset: { nodeTargetExample: 'chat.openai.com', nodeTargetKind: 'DOMAIN' }, attrs: { type: 'button' }, textContent: 'chat.openai.com' })
        ])
      ]),
      el('div', { id: 'nodeTargetList', className: 'node-target-list' }),
      el('footer', { className: 'node-member-actions' }, [
        el('small', { id: 'nodeTargetFootnote', textContent: '提示：具体网站 > 场景规则；用户规则优先于订阅规则。' }),
        el('button', { className: 'ghost compact', dataset: { closeNodeTargetEditor: '1' }, attrs: { type: 'button' }, textContent: '完成' })
      ])
    ])
  ]);
  overlay.addEventListener('click', handleNodeTargetEditorClick);
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target?.id === 'nodeTargetConditionInput') {
      event.preventDefault();
      void addNodeTargetRuleFromEditor();
    }
  });
  overlay.addEventListener('input', (event) => {
    if (event.target?.id === 'nodeTargetConditionInput') updateNodeTargetInputHint();
  });
  overlay.addEventListener('change', (event) => {
    if (event.target?.id === 'nodeTargetKindSelect') updateNodeTargetInputHint();
  });
  document.body.append(overlay);
}

function closeNodeGroupContextMenu() {
  const menu = $('#nodeGroupContextMenu');
  if (menu) menu.classList.add('hidden');
  nodeGroupContextName = '';
}

function nodeGroupContextSection(label) {
  return el('div', { className: 'node-group-context-section', textContent: label });
}

function nodeGroupContextButton(label, action, options = {}) {
  return el('button', {
    dataset: { nodeGroupMenuAction: action },
    disabled: Boolean(options.disabled),
    attrs: { type: 'button' }
  }, [
    el('b', { textContent: label }),
    options.hint ? el('small', { textContent: options.hint }) : null
  ]);
}

function openNodeGroupContextMenu(event) {
  const button = event.target.closest('[data-node-group]');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  const name = button.dataset.nodeGroup || '';
  const group = normalizeNodeGroups(latestGroups).find((item) => item.name === name);
  if (!group) return;
  nodeGroupContextName = name;
  ensureNodeGroupContextMenu();
  const menu = $('#nodeGroupContextMenu');
  if (!menu) return;
  const autoLocked = isAutoSelectGroup(group);
  replaceChildrenSafe(menu, [
    el('div', { className: 'node-group-context-title' }, [
      el('b', { textContent: name }),
      el('small', { textContent: autoLocked ? '\u81ea\u52a8\u9009\u62e9\u662f\u6392\u540d\u89c6\u56fe\uff0c\u4e0d\u76f4\u63a5\u7f16\u8f91' : nodeGroupSummary(group) })
    ]),
    nodeGroupContextSection('\u7b56\u7565\u7ec4'),
    nodeGroupContextButton('\u91cd\u547d\u540d\u7b56\u7565\u7ec4', 'rename', { disabled: autoLocked, hint: '\u53ea\u6539\u663e\u793a\u540d\uff0c\u4e0d\u6539\u8282\u70b9' }),
    nodeGroupContextButton('\u9009\u62e9\u7ec4\u5185\u8282\u70b9', 'members', { disabled: autoLocked, hint: '\u6309\u5730\u533a\u6216\u5355\u4e2a\u8282\u70b9\u52fe\u9009' }),
    nodeGroupContextSection('\u5206\u6d41'),
    nodeGroupContextButton('\u7ba1\u7406\u76ee\u6807\u7f51\u7ad9', 'targets', { disabled: autoLocked, hint: '\u6307\u5b9a\u54ea\u4e9b\u7f51\u7ad9\u8d70\u6b64\u7ec4' }),
    nodeGroupContextSection('\u5e03\u5c40'),
    nodeGroupContextButton('\u6dfb\u52a0\u7b56\u7565\u7ec4', 'add', { hint: '\u65b0\u7ec4\u9ed8\u8ba4\u4f7f\u7528 Proxies \u8282\u70b9' }),
    nodeGroupContextButton('\u62d6\u52a8\u6392\u5e8f', 'sort', { hint: '\u5361\u7247\u6d6e\u8d77\u540e\u62d6\u5230\u65b0\u4f4d\u7f6e' }),
    nodeGroupContextButton('\u5220\u9664\u7b56\u7565\u7ec4', 'delete', { disabled: isProxiesGroup(group) || autoLocked, hint: '\u5df2\u88ab\u89c4\u5219\u4f7f\u7528\u65f6\u4f1a\u963b\u6b62' })
  ]);
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - 260)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - 260)}px`;
  menu.classList.remove('hidden');
}

async function refreshNodeGroupsAfterEdit() {
  await refreshNodes(true, { target: 'nodes' });
  if (isPageActive('routing')) await refreshRoutingSnapshot();
}

async function editNodeGroupName(name = '') {
  const raw = rawNodeGroupForName(name);
  if (!raw) return;
  const nextName = await requestAppInput({
    title: '',
    message: `重命名策略组：${name}`,
    label: '',
    value: name,
    hint: '只改显示名称，不改变节点',
    okText: ''
  });
  if (nextName == null) return;
  const trimmed = nextName.trim();
  if (!trimmed) {
    setNotice('名称不能为空');
    return;
  }
  if (trimmed === name) return;
  await runBackgroundJob('applyRoutingGroupEdit', {
    action: 'edit',
    name,
    new_name: trimmed,
    group_type: raw.type || 'select',
    items: directMemberNamesForGroup(name)
  }, { label: '\u91cd\u547d\u540d\u7b56\u7565\u7ec4' });
  await refreshNodeGroupsAfterEdit();
}

async function editNodeGroupMembers(name = '') {
  const raw = rawNodeGroupForName(name);
  if (!raw) return;
  openNodeGroupMemberEditor(name);
}

function allEditableNodeItems() {
  const seen = new Set();
  return allRealProxyItemsFromGroups(latestGroups).filter((item) => {
    const name = String(item?.name || '').trim();
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

function nodeMemberRegionOptions(items = []) {
  const regions = new Set(items.map((item) => inferRegion(item.name || '')).filter(Boolean));
  return ['ALL', 'HK', 'TW', 'US', 'JP', 'SG', 'GB', 'GL']
    .filter((region) => region === 'ALL' || regions.has(region));
}

function renderNodeMemberEditor() {
  if (!nodeGroupMemberEditorState) return;
  const { groupName, selected, region } = nodeGroupMemberEditorState;
  const items = allEditableNodeItems();
  const visibleItems = region && region !== 'ALL'
    ? items.filter((item) => inferRegion(item.name || '') === region)
    : items;
  $('#nodeMemberTitle').textContent = `\u9009\u62e9\u53ef\u7528\u8282\u70b9\uff1a${groupName}`;
  $('#nodeMemberHint').textContent = '\u4fdd\u5b58\u540e\u6b64\u7b56\u7565\u7ec4\u5c06\u4f7f\u7528\u52fe\u9009\u7684\u8282\u70b9\uff1b\u6309\u56fd\u5bb6\u6807\u7b7e\u53ef\u6279\u91cf\u9009\u62e9\u3002';
  replaceChildrenSafe($('#nodeMemberRegions'), nodeMemberRegionOptions(items).map((itemRegion) => el('button', {
    className: itemRegion === region ? 'active' : '',
    dataset: { nodeMemberRegion: itemRegion },
    attrs: { type: 'button' }
  }, [
    el('b', { textContent: itemRegion === 'ALL' ? '\u5168' : itemRegion }),
    text(itemRegion === 'ALL' ? '\u5168\u90e8' : (regionNames[itemRegion] || itemRegion))
  ])));
  replaceChildrenSafe($('#nodeMemberList'), visibleItems.map((item) => {
    const name = String(item.name || '');
    const regionLabel = inferRegion(name);
    return el('label', { className: 'node-member-row' }, [
      el('input', {
        dataset: { nodeMemberName: name },
        attrs: { type: 'checkbox', value: name, checked: selected.has(name) }
      }),
      el('span', { className: 'node-badge', textContent: regionLabel }),
      el('b', { textContent: name }),
      el('small', { textContent: item.server || '-' })
    ]);
  }));
  $('#nodeMemberCount').textContent = `${selected.size} / ${items.length}`;
}

function openNodeGroupMemberEditor(groupName = '') {
  const selected = new Set(editableMemberNamesForGroup(groupName));
  nodeGroupMemberEditorState = { groupName, selected, region: 'ALL' };
  ensureNodeGroupMemberEditor();
  renderNodeMemberEditor();
  $('#nodeGroupMemberEditor')?.classList.remove('hidden');
}

function closeNodeGroupMemberEditor() {
  nodeGroupMemberEditorState = null;
  $('#nodeGroupMemberEditor')?.classList.add('hidden');
}

async function saveNodeGroupMemberEditor() {
  if (!nodeGroupMemberEditorState) return;
  const { groupName, selected } = nodeGroupMemberEditorState;
  const raw = rawNodeGroupForName(groupName);
  if (!raw) return;
  const items = [...selected];
  if (!items.length) {
    setNotice('\u7b56\u7565\u7ec4\u81f3\u5c11\u8981\u5305\u542b\u4e00\u4e2a\u8282\u70b9\u3002');
    return;
  }
  const result = await runBackgroundJob('applyRoutingGroupEdit', {
    action: 'edit',
    name: groupName,
    new_name: groupName,
    group_type: raw.type || 'select',
    items
  }, { label: '\u4fdd\u5b58\u7b56\u7565\u7ec4\u8282\u70b9' });
  if (!result) return;
  closeNodeGroupMemberEditor();
  await refreshNodeGroupsAfterEdit();
}

function handleNodeMemberEditorClick(event) {
  if (event.target.id === 'nodeGroupMemberEditor' || event.target.closest('[data-close-node-member-editor]')) {
    closeNodeGroupMemberEditor();
    return;
  }
  const regionButton = event.target.closest('[data-node-member-region]');
  if (regionButton && nodeGroupMemberEditorState) {
    nodeGroupMemberEditorState.region = regionButton.dataset.nodeMemberRegion || 'ALL';
    renderNodeMemberEditor();
    return;
  }
  if (event.target.closest('[data-select-visible-node-members]') && nodeGroupMemberEditorState) {
    const region = nodeGroupMemberEditorState.region;
    allEditableNodeItems()
      .filter((item) => region === 'ALL' || inferRegion(item.name || '') === region)
      .forEach((item) => nodeGroupMemberEditorState.selected.add(item.name));
    renderNodeMemberEditor();
    return;
  }
  if (event.target.closest('[data-select-all-node-members]') && nodeGroupMemberEditorState) {
    allEditableNodeItems().forEach((item) => nodeGroupMemberEditorState.selected.add(item.name));
    renderNodeMemberEditor();
    return;
  }
  if (event.target.closest('[data-clear-node-members]') && nodeGroupMemberEditorState) {
    nodeGroupMemberEditorState.selected.clear();
    renderNodeMemberEditor();
    return;
  }
  if (event.target.closest('[data-save-node-members]')) {
    void saveNodeGroupMemberEditor();
    return;
  }
  const checkbox = event.target.closest('[data-node-member-name]');
  if (checkbox && nodeGroupMemberEditorState) {
    const name = checkbox.dataset.nodeMemberName || '';
    if (checkbox.checked) nodeGroupMemberEditorState.selected.add(name);
    else nodeGroupMemberEditorState.selected.delete(name);
    $('#nodeMemberCount').textContent = `${nodeGroupMemberEditorState.selected.size} / ${allEditableNodeItems().length}`;
  }
}

function rulesTargetingGroup(name = '') {
  const rules = Array.isArray(latestRoutingSnapshot?.rules) ? latestRoutingSnapshot.rules : [];
  return rules.filter((rule) => String(rule?.target || '') === name);
}

function routingRuleSourceLabel(rule = {}) {
  const category = routingRuleCategory(rule);
  if (category === 'user') return '用户规则';
  if (category === 'system') return '系统规则';
  return '订阅规则';
}

function routingRuleKindDetail(rule = {}) {
  const kind = String(rule.kind || '').toUpperCase();
  if (kind === 'DOMAIN-SUFFIX') return '网站后缀';
  if (kind === 'DOMAIN') return '完整域名';
  if (kind === 'DOMAIN-KEYWORD') return '关键词';
  if (kind === 'PROCESS-NAME' || kind === 'PROCESS-PATH') return '应用';
  if (kind === 'GEOSITE') return '规则集合';
  if (kind === 'GEOIP') return '国家 IP';
  if (kind.startsWith('IP-')) return 'IP ';
  return routingKindLabel(kind);
}

function renderNodeTargetEditor() {
  if (!nodeGroupTargetEditorState) return;
  const { groupName } = nodeGroupTargetEditorState;
  const rules = rulesTargetingGroup(groupName);
  const userRules = rules.filter((rule) => routingRuleCategory(rule) === 'user');
  const readonlyRules = rules.filter((rule) => routingRuleCategory(rule) !== 'user');
  $('#nodeTargetTitle').textContent = `目标网站：${groupName}`;
  $('#nodeTargetHint').textContent = `这些网站会走 ${groupName}，用户规则优先于场景规则。`;
  replaceChildrenSafe($('#nodeTargetSummary'), [
    el('div', { className: 'node-target-summary-card' }, [
      el('b', { textContent: String(userRules.length) }),
      el('span', { textContent: '用户规则' })
    ]),
    el('div', { className: 'node-target-summary-card' }, [
      el('b', { textContent: String(readonlyRules.length) }),
      el('span', { textContent: '只读规则' })
    ]),
    el('div', { className: 'node-target-summary-note' }, [
      el('b', { textContent: '优先级' }),
      el('span', { textContent: '具体网站 > 场景规则；用户规则 > 订阅规则。' })
    ])
  ]);
  const rows = rules.map((rule) => {
    const category = routingRuleCategory(rule);
    const editable = category === 'user' && rule.raw;
    return el('article', { className: `node-target-row ${editable ? '' : 'readonly'}` }, [
      el('div', {}, [
        el('div', { className: 'node-target-row-title' }, [
          el('b', { textContent: rule.condition || '-' }),
          el('span', { className: `node-target-source ${category}`, textContent: routingRuleSourceLabel(rule) })
        ]),
        el('small', { textContent: `${routingRuleKindDetail(rule)} -> ${routingTargetLabel(rule.target)}` })
      ]),
      editable
        ? el('button', { className: 'ghost compact danger', dataset: { deleteNodeTargetRule: rule.raw || '' }, attrs: { type: 'button' }, textContent: '删除' })
        : el('span', { className: 'routing-readonly-pill', textContent: '只读' })
    ]);
  });
  replaceChildrenSafe($('#nodeTargetList'), rows.length ? rows : [
    emptyState(`还没有网站指定到 ${groupName}，可以先添加 bilibili.com 试一下。`)
  ]);
  updateNodeTargetInputHint();
}

async function openNodeGroupTargetEditor(name = '') {
  if (!name) return;
  if (!latestRoutingSnapshot) await refreshRoutingSnapshot();
  nodeGroupTargetEditorState = { groupName: name };
  ensureNodeGroupTargetEditor();
  renderNodeTargetEditor();
  $('#nodeGroupTargetEditor')?.classList.remove('hidden');
  runWhenIdle(() => $('#nodeTargetConditionInput')?.focus?.());
}

function closeNodeGroupTargetEditor() {
  nodeGroupTargetEditorState = null;
  $('#nodeGroupTargetEditor')?.classList.add('hidden');
}

function normalizeNodeTargetCondition(kind = '', value = '') {
  const ruleKind = String(kind || 'DOMAIN-SUFFIX').toUpperCase();
  const raw = String(value || '').trim();
  if (!raw) return { ok: false, error: '请输入目标网站。' };
  if (ruleKind === 'DOMAIN-KEYWORD') {
    const keyword = raw.replace(/[,\s]/g, '').toLowerCase();
    if (!/^[a-z0-9_.-]{2,80}$/i.test(keyword)) return { ok: false, error: '关键词格式不对，例如 bilibili。' };
    return { ok: true, condition: keyword };
  }
  const parsed = normalizeWebsiteRuleInput(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, condition: parsed.domain };
}

function sameTargetRule(rule = {}, kind = '', condition = '') {
  return String(rule.kind || '').toUpperCase() === String(kind || '').toUpperCase()
    && String(rule.condition || '').trim().toLowerCase() === String(condition || '').trim().toLowerCase();
}

function nodeTargetRuleConflict(groupName = '', kind = '', condition = '') {
  const rules = Array.isArray(latestRoutingSnapshot?.rules) ? latestRoutingSnapshot.rules : [];
  const matches = rules.filter((rule) => sameTargetRule(rule, kind, condition));
  const exactUser = matches.find((rule) => routingRuleCategory(rule) === 'user' && String(rule.target || '') === groupName);
  const otherUser = matches.find((rule) => routingRuleCategory(rule) === 'user' && String(rule.target || '') !== groupName);
  const readonly = matches.find((rule) => routingRuleCategory(rule) !== 'user');
  if (exactUser) {
    return { level: 'bad', message: `已存在相同用户规则：${condition} -> ${groupName}` };
  }
  if (otherUser) {
    return { level: 'bad', message: `这个网站已被用户规则指定到 ${routingTargetLabel(otherUser.target)}，请先删除原规则。` };
  }
  if (readonly) {
    return { level: 'warn', message: `订阅内已有相同规则，添加后用户规则会优先生效到 ${groupName}。` };
  }
  return { level: 'ok', message: `可以添加：${condition} -> ${groupName}` };
}

function updateNodeTargetInputHint() {
  const hint = $('#nodeTargetInputHint');
  if (!hint || !nodeGroupTargetEditorState) return;
  const kind = $('#nodeTargetKindSelect')?.value || 'DOMAIN-SUFFIX';
  const parsed = normalizeNodeTargetCondition(kind, $('#nodeTargetConditionInput')?.value || '');
  hint.classList.remove('is-bad', 'is-warn', 'is-ok');
  if (!$('#nodeTargetConditionInput')?.value?.trim()) {
    hint.textContent = '输入后 Aegos 会立即检查重复和冲突';
    return;
  }
  if (!parsed.ok) {
    hint.textContent = parsed.error;
    hint.classList.add('is-bad');
    return;
  }
  const conflict = nodeTargetRuleConflict(nodeGroupTargetEditorState.groupName, kind, parsed.condition);
  hint.textContent = conflict.message;
  hint.classList.add(`is-${conflict.level}`);
}

async function addNodeTargetRuleFromEditor() {
  if (!nodeGroupTargetEditorState) return;
  const groupName = nodeGroupTargetEditorState.groupName;
  const kind = $('#nodeTargetKindSelect')?.value || 'DOMAIN-SUFFIX';
  const parsed = normalizeNodeTargetCondition(kind, $('#nodeTargetConditionInput')?.value || '');
  if (!parsed.ok) {
    setNotice(parsed.error);
    return;
  }
  const conflict = nodeTargetRuleConflict(groupName, kind, parsed.condition);
  if (conflict.level === 'bad') {
    setNotice(conflict.message);
    updateNodeTargetInputHint();
    return;
  }
  await runBackgroundJob('applyRoutingRuleEdit', {
    action: 'add',
    kind,
    condition: parsed.condition,
    target: groupName,
    option: '',
    label: `${parsed.condition} -> ${groupName}`
  }, { label: '添加目标网站' });
  $('#nodeTargetConditionInput').value = '';
  await refreshRoutingSnapshot();
  nodeGroupTargetEditorState = { groupName };
  renderNodeTargetEditor();
  updateNodeTargetInputHint();
  setNotice(conflict.level === 'warn' ? '目标网站已添加，并优先于订阅规则。' : '目标网站已添加');
}

async function deleteNodeTargetRuleFromEditor(raw = '') {
  if (!nodeGroupTargetEditorState || !raw) return;
  const groupName = nodeGroupTargetEditorState.groupName;
  const rule = rulesTargetingGroup(groupName).find((item) => item.raw === raw);
  const confirmed = await requestAppConfirm({
    title: '删除目标网站',
    message: `删除 ${rule?.condition || raw} 后，它不再固定走 ${groupName}，相关流量会回到其他规则判断。`,
    okText: '删除',
    danger: true
  });
  if (!confirmed) return;
  await runBackgroundJob('applyRoutingRuleEdit', { action: 'delete', raw }, { label: '删除目标网站' });
  await refreshRoutingSnapshot();
  nodeGroupTargetEditorState = { groupName };
  renderNodeTargetEditor();
  setNotice('目标网站已删除');
}

function handleNodeTargetEditorClick(event) {
  if (event.target.id === 'nodeGroupTargetEditor' || event.target.closest('[data-close-node-target-editor]')) {
    closeNodeGroupTargetEditor();
    return;
  }
  const exampleButton = event.target.closest('[data-node-target-example]');
  if (exampleButton) {
    const kind = exampleButton.dataset.nodeTargetKind || 'DOMAIN-SUFFIX';
    const value = exampleButton.dataset.nodeTargetExample || '';
    const select = $('#nodeTargetKindSelect');
    const input = $('#nodeTargetConditionInput');
    if (select) select.value = kind;
    if (input) {
      input.value = value;
      input.focus();
      input.select?.();
    }
    updateNodeTargetInputHint();
    return;
  }
  if (event.target.closest('[data-add-node-target-rule]')) {
    void addNodeTargetRuleFromEditor();
    return;
  }
  const deleteButton = event.target.closest('[data-delete-node-target-rule]');
  if (deleteButton) {
    void deleteNodeTargetRuleFromEditor(deleteButton.dataset.deleteNodeTargetRule || '');
  }
}

async function manageNodeGroupTargets(name = '') {
  await openNodeGroupTargetEditor(name);
}

async function addNodeGroupFromNodesPage(anchorName = '') {
  const name = await requestAppInput({
    title: '添加策略组',
    message: '创建一个新的手动策略组',
    label: '',
    placeholder: '例如：工作网站',
    hint: '默认使用 Proxies 作为节点来源，稍后可以编辑组内节点。',
    okText: '添加'
  });
  if (name == null) return;
  const trimmed = name.trim();
  if (!trimmed) {
    setNotice('名称不能为空');
    return;
  }
  const defaultMember = latestGroups.some(isProxiesGroup) ? 'Proxies' : anchorName;
  await runBackgroundJob('applyRoutingGroupEdit', {
    action: 'add',
    name: trimmed,
    new_name: trimmed,
    group_type: 'select',
    items: [defaultMember].filter(Boolean)
  }, { label: '\u6dfb\u52a0\u7b56\u7565\u7ec4' });
  await refreshNodeGroupsAfterEdit();
}

async function deleteNodeGroupFromNodesPage(name = '') {
  if (!name || isProxiesGroup({ name })) return;
  const confirmed = await requestAppConfirm({
    title: '删除策略组',
    message: `删除策略组 ${name}？Aegos 会先检查是否仍被规则使用。`,
    okText: '删除',
    danger: true
  });
  if (!confirmed) return;
  await runBackgroundJob('applyRoutingGroupEdit', { action: 'delete', name }, { label: '\u5220\u9664\u7b56\u7565\u7ec4' });
  await refreshNodeGroupsAfterEdit();
}

function enterNodeGroupSortMode() {
  nodeGroupSortMode = true;
  nodeGroupDraftOrder = normalizeNodeGroups(latestGroups).map((group) => group.name).filter(Boolean);
  renderNodeGroupSwitcher();
  setNotice('\u5df2\u8fdb\u5165\u7b56\u7565\u7ec4\u6392\u5e8f\u6a21\u5f0f\uff0c\u62d6\u52a8\u5361\u7247\u540e\u70b9\u51fb\u5b8c\u6210\u4fdd\u5b58\u3002');
}

function finishNodeGroupSort(save) {
  if (save && nodeGroupDraftOrder.length) {
    nodeGroupOrderOverrides = {
      ...nodeGroupOrderOverrides,
      [activeProfileStorageKey()]: [...nodeGroupDraftOrder]
    };
    saveNodeGroupOrderOverrides();
    setNotice('\u7b56\u7565\u7ec4\u6392\u5e8f\u5df2\u4fdd\u5b58\u3002');
  } else {
    setNotice('\u5df2\u53d6\u6d88\u7b56\u7565\u7ec4\u6392\u5e8f\u3002');
  }
  nodeGroupSortMode = false;
  nodeGroupDragName = '';
  nodeGroupDraftOrder = [];
  renderNodeGroupSwitcher();
}

function moveDraftGroupBefore(sourceName, targetName) {
  if (!sourceName || !targetName || sourceName === targetName) return;
  const order = nodeGroupDraftOrder.length ? [...nodeGroupDraftOrder] : normalizeNodeGroups(latestGroups).map((group) => group.name).filter(Boolean);
  const from = order.indexOf(sourceName);
  const to = order.indexOf(targetName);
  if (from < 0 || to < 0) return;
  const [item] = order.splice(from, 1);
  order.splice(to, 0, item);
  nodeGroupDraftOrder = order;
  renderNodeGroupSwitcher();
}

function handleNodeGroupPointerDown(event) {
  if (!nodeGroupSortMode) return;
  const button = event.target.closest('[data-node-group]');
  if (!button) return;
  nodeGroupDragName = button.dataset.nodeGroup || '';
  button.classList.add('dragging');
  event.preventDefault();
}

function handleNodeGroupPointerUp(event) {
  if (!nodeGroupSortMode || !nodeGroupDragName) return;
  const button = event.target.closest('[data-node-group]');
  const source = nodeGroupDragName;
  $all('.node-group-card.dragging').forEach((item) => item.classList.remove('dragging'));
  nodeGroupDragName = '';
  if (!button) return;
  moveDraftGroupBefore(source, button.dataset.nodeGroup || '');
}

function handleNodeGroupDragStart(event) {
  if (!nodeGroupSortMode) {
    event.preventDefault();
    return;
  }
  const button = event.target.closest('[data-node-group]');
  if (!button) return;
  nodeGroupDragName = button.dataset.nodeGroup || '';
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', nodeGroupDragName);
}

function handleNodeGroupDragOver(event) {
  if (!nodeGroupSortMode || !nodeGroupDragName) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
}

function handleNodeGroupDrop(event) {
  if (!nodeGroupSortMode || !nodeGroupDragName) return;
  const button = event.target.closest('[data-node-group]');
  if (!button) return;
  event.preventDefault();
  moveDraftGroupBefore(nodeGroupDragName, button.dataset.nodeGroup || '');
}

async function handleNodeGroupMenuAction(action = '') {
  const name = nodeGroupContextName;
  closeNodeGroupContextMenu();
  if (action === 'rename') return editNodeGroupName(name);
  if (action === 'members') return editNodeGroupMembers(name);
  if (action === 'targets') return manageNodeGroupTargets(name);
  if (action === 'add') return addNodeGroupFromNodesPage(name);
  if (action === 'sort') return enterNodeGroupSortMode();
  if (action === 'delete') return deleteNodeGroupFromNodesPage(name);
  return null;
}

function renderNodeGroupSwitcher() {
  ensureNodeGroupSwitcher();
  const strip = $('#nodeGroupStrip');
  if (!strip) return;
  $('#nodeGroupSortBar')?.classList.toggle('hidden', !nodeGroupSortMode);
  strip.classList.toggle('sorting', nodeGroupSortMode);
  const groups = normalizeNodeGroups(latestGroups);
  if (!groups.length) {
    replaceChildrenSafe(strip, [emptyState('\u6682\u65e0\u7b56\u7565\u7ec4\u3002')]);
    return;
  }
  replaceChildrenSafe(strip, groups.map((group) => {
    const active = group.name === latestGroup?.name;
    return el('button', {
      className: `node-group-card ${active ? 'active' : ''} ${isAutoSelectGroup(group) ? 'auto' : ''}`,
      dataset: { nodeGroup: group.name || '' },
      attrs: { type: 'button', title: nodeGroupTitle(group), draggable: nodeGroupSortMode ? 'true' : 'false' }
    }, [
      nodeGroupSortMode ? el('span', { className: 'node-group-drag-handle', textContent: '\u2630' }) : null,
      el('b', { textContent: group.name || 'GLOBAL' }),
      el('small', { textContent: nodeGroupSummary(group) })
    ]);
  }));
}

function selectProxyGroup(name = '') {
  const group = preferredProxyGroup(latestGroups, name);
  if (!group) return;
  selectedProxyGroupName = group.name || '';
  setLatestGroup(group);
  selectedNode = latestGroup?.now || selectedNode;
  scheduleRowsRender(latestGroup?.items || [], { force: true, target: 'nodes', delay: 0, transition: true });
  renderHomeNodeSummary(summaryRowsFromLatestGroup());
  setNotice(`\u5df2\u5207\u6362\u7b56\u7565\u7ec4\uff1a${selectedProxyGroupName || '-'}`);
}

function activeBackendProxyGroupName(group = latestGroup) {
  if (!group) return '';
  return group.backendGroupName || group.name || '';
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
  if (/hong\s*kong|hongkong|香港|\bhk\b/.test(text)) return 'HK';
  if (/japan|日本|东京|大阪|\bjp\b/.test(text)) return 'JP';
  if (/singapore|新加坡|\bsg\b/.test(text)) return 'SG';
  if (/taiwan|台湾|台灣|\btw\b/.test(text)) return 'TW';
  if (/united\s*states|usa|america|美国|美國|\bus\b/.test(text)) return 'US';
  if (/britain|united\s*kingdom|uk|英国|英國|\bgb\b/.test(text)) return 'GB';
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
          item.lastFailureReason || item.last_failure_reason || '',
          item.backendGroupName || ''
        ];
      })
    : fallbackNodes.map((row, index) => [...row, -1, true, index === 0, 'direct', 'unknown', -1, 0, 999999, false, 0, false, false, index === 0 ? 1 : 0, 'unknown', 0, '', '']);
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
    status.resultSignature || '',
    status.running ? '1' : '0',
    status.runId || 0,
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
    item.lastFailureReason || item.last_failure_reason || '',
    item.backendGroupName || ''
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
    item.lastFailureReason || item.last_failure_reason || '',
    item.backendGroupName || ''
  ];
}

function isProxyGroupReferenceItem(item = {}) {
  const type = String(item.type || item.protocol || '').toLowerCase();
  const name = String(item.name || '').trim();
  const groupNames = new Set((latestGroups || []).map((group) => String(group?.name || '').trim()).filter(Boolean));
  const groupLikeType = /^(group|selector|urltest|url-test|fallback|loadbalance|load-balance|relay)$/i.test(type);
  return Boolean(
    item.group
    || item.isGroup
    || Array.isArray(item.all)
    || Array.isArray(item.items)
    || (groupLikeType && groupNames.has(name))
  );
}

function isBuiltinPolicyItem(item = {}) {
  const name = String(item.name || '').trim().toUpperCase();
  const type = String(item.type || item.protocol || '').trim().toUpperCase();
  return Boolean(item.builtin || ['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE'].includes(name) || ['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE'].includes(type));
}

function isRealProxyNodeItem(item = {}) {
  return !isProxyGroupReferenceItem(item) && !isBuiltinPolicyItem(item);
}

function nodeGroupStats(group = {}) {
  const items = Array.isArray(group.items) ? group.items : [];
  const realNodes = items.filter(isRealProxyNodeItem).length;
  return {
    total: items.length,
    realNodes,
    policyOptions: Math.max(0, items.length - realNodes)
  };
}

function isFixedNodeItem(item = {}) {
  const text = `${item.name || ''} ${item.server || ''} ${item.source || ''} ${item.profileType || ''} ${item.type || ''}`.toLowerCase();
  return Boolean(item.manual || item.fixed || item.static || item.residential || /手动|固定|静态|住宅|manual|fixed|static|residential/.test(text));
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

function sortableDelay(row = []) {
  const delay = Number(row[3]);
  if (delay > 0) return delay;
  if (delay === 0) return 999998;
  return 999999;
}

function sortableStatus(row = []) {
  const delay = Number(row[3]);
  if (delay > 0 && delay < 100) return 0;
  if (delay >= 100) return 1;
  if (delay === 0) return 2;
  if (row[18] || Number(row[12] || 0) > 0) return 3;
  return 4;
}

function compareNodeRowsByKey(a, b, key) {
  if (key === 'name') {
    return String(a[1] || '').localeCompare(String(b[1] || ''), 'zh-Hans-CN')
      || sortableDelay(a) - sortableDelay(b);
  }
  if (key === 'delay') {
    return sortableDelay(a) - sortableDelay(b)
      || sortableStatus(a) - sortableStatus(b)
      || String(a[1] || '').localeCompare(String(b[1] || ''), 'zh-Hans-CN');
  }
  if (key === 'status') {
    return sortableStatus(a) - sortableStatus(b)
      || sortableDelay(a) - sortableDelay(b)
      || String(a[1] || '').localeCompare(String(b[1] || ''), 'zh-Hans-CN');
  }
  return 0;
}

function sortNodeRows(rows = []) {
  if (!nodeSortState.key || !nodeSortState.direction) return rows;
  const direction = nodeSortState.direction;
  return [...rows].sort((a, b) => compareNodeRowsByKey(a, b, nodeSortState.key) * direction);
}

function sortLabel(key) {
  if (nodeSortState.key !== key || !nodeSortState.direction) return '';
  return nodeSortState.direction > 0 ? '。' : '';
}

function updateNodeSortHeaders() {
  ensureNodeSortHeader();
  $all('[data-node-sort]').forEach((button) => {
    const key = button.dataset.nodeSort || '';
    const active = key === nodeSortState.key && nodeSortState.direction !== 0;
    button.classList.toggle('active', active);
    button.setAttribute('aria-sort', active ? (nodeSortState.direction > 0 ? 'ascending' : 'descending') : 'none');
    const mark = button.querySelector('.sort-mark');
    if (mark) mark.textContent = sortLabel(key);
  });
}

function cycleNodeSort(key = '') {
  if (!key) return;
  if (nodeSortState.key !== key) nodeSortState = { key, direction: 1 };
  else if (nodeSortState.direction === 1) nodeSortState = { key, direction: -1 };
  else nodeSortState = { key: '', direction: 0 };
  updateNodeSortHeaders();
  scheduleRowsRender(latestGroup?.items || [], { force: true, target: 'nodes', delay: 0 });
}

function nodeSortButton(key, label) {
  return el('button', {
    className: 'node-sort-button',
    dataset: { nodeSort: key },
    attrs: { type: 'button', 'aria-sort': 'none', title: `${label}排序` }
  }, [
    text(label),
    el('span', { className: 'sort-mark' })
  ]);
}

function ensureNodeSortHeader() {
  const head = document.querySelector('.node-table .row.head');
  if (!head || head.dataset.sortReady === 'true') return;
  head.dataset.sortReady = 'true';
  replaceChildrenSafe(head, [
    el('span'),
    el('span'),
    nodeSortButton('name', '节点名称'),
    el('span', { textContent: '地址' }),
    nodeSortButton('delay', '延迟'),
    nodeSortButton('status', '状态'),
    el('span', { className: 'row-action-labels' }, [
      el('span', { textContent: '测速' }),
      el('span', { textContent: '编辑' }),
      el('span', { textContent: '收藏' })
    ])
  ]);
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
  if (!key) return '失败';
  if (key.includes('fake-ip') || key.includes('fake ip')) return 'DNS 伪 IP' ;
  if (key.includes('protection') || key.includes('firewall') || key.includes('kill')) return '保护模式限制';
  if (key.includes('blocked')) return '被阻断';
  if (key.includes('unreachable')) return '不可达';
  if (key.includes('node-not-found')) return '节点不存在';
  if (key.includes('node-connect')) return '节点连接失败';
  if (key.includes('controller-delay')) return '控制器测速失败';
  if (key.includes('probe-failed')) return '探测失败';
  if (key.includes('timeout')) return '超时';
  if (key.includes('dns')) return 'DNS 失败';
  if (key.includes('tls')) return 'TLS 失败';
  if (key.includes('auth')) return '认证失败';
  if (key.includes('controller')) return '控制器异常';
  if (key.includes('unsupported')) return '协议不支持';
  if (key.includes('config')) return '配置错误';
  if (key.includes('network')) return '网络失败';
  return '失败';
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

function summaryRowsFromLatestGroup(limit = 160) {
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
    const currentIndex = nodeIndexForName(currentName);
    if (Number.isInteger(currentIndex) && currentIndex >= 0) {
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
  const backendGroup = row?.[19] || activeBackendProxyGroupName();
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
    dataset: { node: name, backendGroup },
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
  const backendGroup = row?.[19] || activeBackendProxyGroupName();
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
    dataset: { node: name, backendGroup },
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
  if (/失败|异常|错误|不可达|超时|failed|error|exception/.test(text)) return 'bad';
  if (/警告|需要|权限|未生效|warning|not elevated|require/.test(text)) return 'warn';
  if (/\.\.\.|正在|中|running|pending/.test(text)) return 'info';
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
  setNotice(`操作异常：${event.message || '未知错误'}`);
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
    .catch((err) => setNotice(`操作失败：${err.message || err}`))
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
    setNotice('已发送后台任务取消请求');
  } catch (err) {
    setNotice(`操作失败：${err.message || err}`);
  }
}

async function retryJob(id) {
  const job = jobRecords.get(id);
  if (!job?.kind) return;
  setNotice(`正在重试：${job.label || job.kind}`);
  await runBackgroundJob(job.kind, job.payload || {});
}

async function runBackgroundJob(kind, payload = {}, options = {}) {
  const blockRefresh = options.blockRefresh === true;
  if (blockRefresh) backgroundJobBusy += 1;
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
        setNotice(total > 1 ? `${job.label}${job.message} ${progress}/${total}` : `${job.label}${job.message}`);
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
    const reason = job?.error || job?.message || '任务失败';
    rememberJob(job);
    lastBackgroundJobError = reason;
    if (options.failureNotice) setNotice(resolveMessage(options.failureNotice, new Error(reason)));
    else setNotice(`${job?.label || '任务'}失败：${reason}`);
    return null;
  } catch (err) {
    lastBackgroundJobError = err.message || String(err);
    if (options.failureNotice) setNotice(resolveMessage(options.failureNotice, err));
    setNotice(`操作失败：${err.message || err}`);
    return null;
  } finally {
    if (blockRefresh) backgroundJobBusy = Math.max(0, backgroundJobBusy - 1);
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

function invalidatePageCache(page) {
  if (!pageCacheState[page]) return;
  pageCacheState[page].loaded = false;
  pageCacheState[page].updatedAt = 0;
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
      if (page === 'routing' && shouldRefreshPageCache(page)) refreshRoutingSnapshot(token);
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
      if (page === 'settings' && shouldRefreshPageCache(page)) {
        pageCacheState.settings.loading = true;
        Promise.allSettled([
          refreshIpv6DnsSafety(),
          refreshEnvironmentReadiness(false)
        ]).finally(() => {
          if (token === pageLoadToken) markPageCache(page);
          else pageCacheState.settings.loading = false;
        });
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
    : fallbackNodes.map(([region, name, server]) => ({ name, server, type: 'probe', region, delay: -1, alive: true, fallback: true }));
  const bestRows = [];
  const fallbackBestRows = [];
  const nodeRows = [];
  const homeRows = [];
  const stabilityRows = [];
  let activeRow = null;
  let matchingNodeCount = 0;
  const largeList = sourceItems.length > 1500;
  const interactiveRender = largeList && (isForegroundHot() || isSpeedTestActive());
  const visibleNodeLimit = interactiveRender ? interactiveNodeRenderLimit : nodeRenderLimit;
  const nodeCandidateLimit = largeList
    ? (nodeSortState.key && !interactiveRender
      ? Math.max(nodeRenderLimit * 4, eagerNodeIndexLimit)
      : (interactiveRender ? interactiveNodeCandidateLimit : nodeRenderLimit))
    : Number.MAX_SAFE_INTEGER;
  const sourceStats = { total: 0, realNodes: 0, policyOptions: 0 };

  for (let index = 0; index < sourceItems.length; index += 1) {
    const item = sourceItems[index];
    sourceStats.total += 1;
    if (!isRealProxyNodeItem(item)) {
      sourceStats.policyOptions += 1;
      continue;
    }
    sourceStats.realNodes += 1;
    const row = normalizeNodeItemCached(item, index);
    if (Number(row[3]) > 0) stabilityRows.push(row);
    rememberBestRow(bestRows, row);
    if (fallbackBestRows.length < 3) fallbackBestRows.push(row);
    if (!activeRow && row[5]) activeRow = row;
    if (shouldRenderNodeRows && itemMatchesNodeSearch(item) && rowMatchesNodeFilter(row, nodePageFilter)) {
      matchingNodeCount += 1;
      if (nodeRows.length < nodeCandidateLimit) nodeRows.push(row);
    }
    if (shouldRenderHomeRows && rowMatchesHomeFilter(row)) {
      rememberRankedRow(homeRows, row, compareHomeRows, homeNodeRenderLimit);
    }
    if (largeList && shouldRenderHomeRows && !shouldRenderNodeRows && homeRows.length >= homeNodeRenderLimit && index > largeNodeScanLimit) {
      break;
    }
    if (largeList && shouldRenderNodeRows && nodeRows.length >= nodeCandidateLimit && (!shouldRenderHomeRows || homeRows.length >= homeNodeRenderLimit) && index > largeNodeScanLimit) {
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
    updateNodeSortHeaders();
    const nodeVisibleLimit = largeList ? visibleNodeLimit : Math.max(nodeInitialRenderLimit, nodeRows.length);
    const visibleNodeRows = sortNodeRows(nodeRows).slice(0, nodeVisibleLimit);
    const nodeChildren = visibleNodeRows.map((row) => renderNodeRow(row));
    if (matchingNodeCount > visibleNodeRows.length) {
      nodeChildren.push(emptyState(`\u5df2\u663e\u793a ${visibleNodeRows.length} / ${matchingNodeCount} \u4e2a\u5339\u914d\u8282\u70b9\uff0c\u8bf7\u641c\u7d22\u6216\u7b5b\u9009\u7f29\u5c0f\u8303\u56f4\u3002`));
    }
    const emptyText = sourceStats.realNodes === 0 && sourceStats.policyOptions > 0
      ? '\u8fd9\u4e2a\u7b56\u7565\u7ec4\u53ea\u5305\u542b\u7b56\u7565/\u76f4\u8fde\u9009\u9879\uff0c\u6ca1\u6709\u76f4\u63a5\u8282\u70b9\uff1b\u8bf7\u9009\u62e9 Proxies \u6216\u5176\u4ed6\u771f\u5b9e\u8282\u70b9\u7ec4\u67e5\u770b\u8282\u70b9\u3002'
      : '\u6682\u65e0\u7b26\u5408\u6761\u4ef6\u7684\u8282\u70b9\u3002';
    replaceChildrenSafe($('#nodeRows'), nodeChildren.length ? nodeChildren : [emptyState(emptyText)]);
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
  const summaryGrid = document.querySelector('[data-page-panel="settings"] .settings-summary-grid');
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
    adminState.textContent = permissions.isAdmin ? STATUS_TEXT.admin : STATUS_TEXT.normalPermission;
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
    takeoverSummary.textContent = takeover.snapshotCaptured ? STATUS_TEXT.savedSnapshot : STATUS_TEXT.takeoverInactive;
    takeoverSummary.classList.toggle('ok', Boolean(takeover.snapshotCaptured));
  }
  $('#settingsRuntimeSummary').textContent = runtimeSummaryLabel(latestStatus, settings);
  $('#settingsProxySummary').textContent = `系统代理${enabledLabel(settings.systemProxy)}`;
  $('#settingsReliabilitySummary').textContent = reliability.auto === false
    ? '手动'
    : `自动 / ${reliability.candidateLimit || 24} 个候选`;
  $('#systemProxyToggle').checked = Boolean(settings.systemProxy);
  $('#startProxyToggle').checked = Boolean(settings.startWithSystemProxy);
  $('#tunToggle').checked = Boolean(settings.tunEnabled);
  $('#dnsToggle').checked = settings.dnsHijackEnabled !== false;
  $('#killToggle').checked = Boolean(settings.killSwitchEnabled);
  $('#ipv6Toggle').checked = Boolean(settings.ipv6Enabled);
  $('#ipv6Toggle').disabled = true;
  $('#allowLanToggle').checked = Boolean(settings.allowLan);
  $('#mixedPortInput').value = mixedPort;
  $('#controllerPortInput').value = controllerPort;
  $('#tunStackSelect').value = settings.tunStack || 'mixed';
  $('#logLevelSelect').value = settings.logLevel || 'info';
  $('#reliabilityAutoToggle').checked = reliability.auto !== false;
  $('#profileFailoverToggle').checked = reliability.profileFailover !== false;
  $('#reliabilityMaxDelayInput').value = reliability.maxDelayMs || 800;
  $('#reliabilityCandidateLimitInput').value = reliability.candidateLimit || 24;
  renderEnvironmentReadiness();
}

function readinessLevelLabel(level = '') {
  if (level === 'error') return STATUS_TEXT.error;
  if (level === 'warn') return STATUS_TEXT.warn;
  if (level === 'ok') return STATUS_TEXT.ok;
  return STATUS_TEXT.unchecked;
}

function renderEnvironmentReadiness(data = latestEnvironmentReadiness) {
  const summaryEl = $('#environmentSummary');
  const rowsEl = $('#environmentRows');
  if (!summaryEl || !rowsEl) return;
  if (!data) {
    summaryEl.textContent = STATUS_TEXT.unchecked;
    replaceChildrenSafe(rowsEl, [emptyState('点击检查环境，确认安装、权限和端口状态。')]);
    return;
  }
  const summary = data.summary || {};
  summaryEl.textContent = `${summary.label || '状态'}  ${summary.errors || 0}  / ${summary.warnings || 0} `;
  summaryEl.className = summary.errors ? 'bad' : summary.warnings ? 'warn' : 'ok';
  const rows = (data.checks || []).map((item) => el('article', { className: `environment-row level-${item.level || 'info'}` }, [
    el('div', {}, [
      el('b', { textContent: item.label || '-' }),
      el('small', { textContent: item.detail || '-' }),
      el('small', { className: 'environment-action', textContent: item.action || '' })
    ]),
    el('span', { textContent: readinessLevelLabel(item.level) })
  ]));
  replaceChildrenSafe(rowsEl, rows.length ? rows : [emptyState('暂无检查项')]);
}

async function refreshEnvironmentReadiness(showNotice = false) {
  if (environmentReadinessBusy) {
    if (showNotice) setNotice('环境检查正在运行');
    return;
  }
  environmentReadinessBusy = true;
  try {
    const data = await invoke('environment_readiness');
    latestEnvironmentReadiness = data;
    renderEnvironmentReadiness(data);
    if (showNotice) setNotice(`环境检查完成：${data.summary?.label || ''}`);
  } catch (err) {
    latestEnvironmentReadiness = null;
    replaceChildrenSafe($('#environmentRows'), [emptyState(`环境检查失败：${err.message || err}`)]);
    if (showNotice) setNotice(`环境检查失败：${err.message || err}`);
  } finally {
    environmentReadinessBusy = false;
  }
}

function ensureIpv6DnsSafetyUi() {
  if ($('#ipv6DnsSafetyCard')) return;
  const securitySections = [...document.querySelectorAll('.settings-section')];
  const target = securitySections.find((section) => section.textContent.includes('DNS') || section.textContent.includes('IPv6'));
  if (!target) return;
  const card = el('div', { id: 'ipv6DnsSafetyCard', className: 'ipv6-safety-card' }, [
    el('article', {}, [el('span', { textContent: 'IPv6 \u6a21\u5f0f' }), el('b', { id: 'ipv6AutoModeState', textContent: '\u81ea\u52a8' })]),
    el('article', {}, [el('span', { textContent: 'IPv4 \u51fa\u53e3' }), el('b', { id: 'ipv4OutletState', textContent: '-' })]),
    el('article', {}, [el('span', { textContent: 'IPv6 \u51fa\u53e3' }), el('b', { id: 'ipv6OutletState', textContent: '-' })]),
    el('article', {}, [el('span', { textContent: '\u6cc4\u6f0f' }), el('b', { id: 'ipv6LeakState', textContent: '-' })]),
    el('article', { className: 'wide' }, [el('span', { textContent: 'DNS \u5b89\u5168' }), el('b', { id: 'dnsLeakState', textContent: '-' })]),
    el('small', { id: 'ipv6PlainPrompt', textContent: 'IPv6 / DNS \u72b6\u6001\u81ea\u52a8\u68c0\u6d4b\uff0c\u4e0d\u4f1a\u6539\u53d8\u5f53\u524d\u8fde\u63a5\u3002' })
  ]);
  target.appendChild(card);
}

function renderIpv6DnsSafety(data = latestIpv6DnsSafety) {
  ensureIpv6DnsSafetyUi();
  if (!data) return;
  $('#ipv6AutoModeState').textContent = data.mode === 'auto' ? '\u81ea\u52a8' : '-';
  $('#ipv4OutletState').textContent = data.currentNodeIpv4?.ok ? data.currentNodeIpv4.ip : '';
  $('#ipv6OutletState').textContent = data.currentNodeIpv6?.ok ? data.currentNodeIpv6.ip : (data.localIpv6?.available ? '\u8282\u70b9\u4e0d\u652f\u6301' : '\u672c\u673a\u65e0 IPv6');
  const leak = data.ipv6Leak || {};
  $('#ipv6LeakState').textContent = leak.level === 'risk' ? '\u6709\u98ce\u9669' : leak.level === 'blocked' ? '\u5df2\u963b\u65ad' : '\u65e0';
  $('#ipv6LeakState').classList.toggle('bad', leak.level === 'risk');
  $('#ipv6LeakState').classList.toggle('ok', leak.level !== 'risk');
  $('#dnsLeakState').textContent = data.dnsLeak?.ok ? '\u5b89\u5168' : '\u5f02\u5e38';
  $('#dnsLeakState').classList.toggle('bad', !data.dnsLeak?.ok);
  $('#dnsLeakState').classList.toggle('ok', Boolean(data.dnsLeak?.ok));
  $('#ipv6PlainPrompt').textContent = data.plainPrompt || 'IPv6 / DNS \u72b6\u6001\u81ea\u52a8\u68c0\u6d4b\uff0c\u4e0d\u4f1a\u6539\u53d8\u5f53\u524d\u8fde\u63a5\u3002';
}

async function refreshIpv6DnsSafety() {
  if (ipv6DnsSafetyBusy) return;
  ipv6DnsSafetyBusy = true;
  ensureIpv6DnsSafetyUi();
  try {
    const data = await invoke('ipv6_dns_safety_snapshot');
    latestIpv6DnsSafety = data;
    renderIpv6DnsSafety(data);
  } catch (err) {
    latestIpv6DnsSafety = null;
    $('#ipv6PlainPrompt').textContent = `IPv6/DNS \u68c0\u6d4b\u5931\u8d25\uff1a${err.message || err}`;
  } finally {
    ipv6DnsSafetyBusy = false;
  }
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
  renderDiagnosticLogPreview();
}

function renderDiagnosticLogPreview() {
  const box = $('#diagLogPreview');
  if (!box) return;
  const importantLogs = (latestStatus?.logs || [])
    .filter((entry) => ['error', 'warn', 'warning', 'core'].includes(String(entry.level || '').toLowerCase()) || ['core', 'diagnostic'].includes(entry.category || ''))
    .slice(-5)
    .reverse();
  replaceChildrenSafe(box, [
    el('div', { className: 'diagnostic-log-head' }, [
      el('div', {}, [
        el('b', { textContent: '最近异常' }),
        el('small', { textContent: '日志统一收在这里，方便排查。' })
      ]),
      el('button', { className: 'ghost compact', dataset: { pageJump: 'logs' }, attrs: { type: 'button' }, textContent: '查看日志' })
    ]),
    el('div', { className: 'diagnostic-log-rows' }, importantLogs.length
      ? importantLogs.map((entry) => el('div', { className: 'diagnostic-log-row' }, [
        el('b', { textContent: entry.level || '-' }),
        el('span', { textContent: entry.line || '-' })
      ]))
      : [emptyState('暂无异常日志')])
  ]);
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

function setOutboundIpText(value, title = '') {
  const text = value || '-';
  $('#outboundIpState').textContent = text;
  $('#outboundMetric').textContent = text;
  $('#outboundIpState').setAttribute('title', title || text);
  $('#outboundMetric').setAttribute('title', title || text);
}

function renderOutboundIpFromStatus(value) {
  if (outboundIpPendingSeq) return;
  outboundIpLastStable = value || outboundIpLastStable || '-';
  setOutboundIpText(outboundIpLastStable);
}

function renderStatus(status) {
  const wasTakeover = latestStatus?.trafficTakeover;
  latestStatus = status;
  reconcileVisibleProxyGroup();

  const settings = status.settings || {};
  const protection = status.protection || {};
  const activeProfile = status.activeProfile || {};
  const traffic = status.traffic || {};
  const coreReady = Boolean(status.coreReady ?? status.running);
  const trafficTakeover = Boolean(status.trafficTakeover || settings.proxyTakeover?.active);
  const connection = status.connection || {};
  const systemProxyApplied = Boolean(connection.systemProxyApplied ?? (trafficTakeover && Boolean(settings.systemProxy)));
  const systemProxyWanted = Boolean(connection.systemProxyWanted ?? settings.systemProxy);
  const availability = networkAvailabilityInfo(status);
  if (trafficTakeover && !wasTakeover) startedAt = Date.now();
  if (!trafficTakeover) startedAt = Date.now();
  const modeText = modeLabel(status.mode);

  $('#appVersionLabel').textContent = `v${status.appVersion || defaultAppVersion}`;
  $('.ring strong').textContent = trafficTakeover ? STATUS_TEXT.connected : coreReady ? STATUS_TEXT.coreStandby : STATUS_TEXT.disconnected;
  $('.ring').classList.toggle('offline', !trafficTakeover);
  $('#nodeName').textContent = selectedNode || latestGroup?.now || activeProfile.name || '等待节点数据';
  const nodeHost = $('#nodeHost');
  if (nodeHost) nodeHost.textContent = status.network?.proxyEndpoint || '-';
  $('#connectBtn').textContent = connectionButtonLabel(status);
  $('#modeLabel').textContent = modeText;
  setNotice(statusSurfaceNotice(status, settings, protection, availability));

  $('#softwareState').textContent = runtimeSummaryLabel(status, settings);
  $('#softwareState').className = coreReady ? 'ok' : '';
  $('#networkAvailabilityState').textContent = availability.label;
  $('#networkAvailabilityState').className = availability.className;
  $('#networkAvailabilityState').setAttribute('title', availability.detail || availability.label);
  $('#networkAvailabilityMetric').textContent = availability.label;
  $('#networkAvailabilityMetric').className = availability.className ? `metric-status-${availability.className}` : '';
  $('#networkAvailabilityMetric').setAttribute('title', availability.detail || availability.label);
  $('#protectMode').textContent = protection.label || STATUS_TEXT.disabled;
  $('#dnsState').textContent = settings.dnsHijackEnabled === false ? STATUS_TEXT.disabled : STATUS_TEXT.enabled;
  $('#tunState').textContent = enabledLabel(settings.tunEnabled);
  $('#killState').textContent = enabledLabel(settings.killSwitchEnabled);
  $('#quickKillBtn')?.classList.toggle('active', Boolean(settings.killSwitchEnabled));
  $('#proxyState').textContent = systemProxyApplied ? STATUS_TEXT.enabled : systemProxyWanted ? STATUS_TEXT.pending : STATUS_TEXT.disabled;
  $('#proxyState').classList.toggle('is-danger', !systemProxyApplied);
  $('#proxyStateRow').classList.remove('hidden');
  $('#protocolState').textContent = currentProtocol;
  $('#protocolMetric').textContent = currentProtocol;
  $('#tunHomeToggle').checked = Boolean(settings.tunEnabled);
  $('#tunHomeState').textContent = enabledLabel(settings.tunEnabled);
  $('#lanIpState').textContent = status.network?.lanIp || '-';
  $('#proxyPortState').textContent = formatProxyPort(status.network?.proxyEndpoint);
  renderOutboundIpFromStatus(status.network?.outboundIp || '-');
  $('#proxyMetric').textContent = formatProxyPort(status.network?.proxyEndpoint);
  $('#systemProxyMetric').textContent = systemProxyUiLabel(systemProxyApplied, systemProxyWanted);
  $('#systemProxyMetric').classList.toggle('is-danger', !systemProxyApplied);

  const up = formatRate(traffic.up);
  const down = formatRate(traffic.down);
  if ($('#upRate')) $('#upRate').textContent = up;
  if ($('#downRate')) $('#downRate').textContent = down;
  renderActiveConnectionMetric();
  renderHomeNodeSummary();
  renderNodeGroupSwitcher();
  renderSettings(status);
  if (isPageActive('profiles')) renderProfiles();
  if (isPageActive('logs')) renderLogs();
  renderQuickProfileMenu();
  warmStaticPageCaches();
}

function applyOptimisticMode(mode) {
  if (latestStatus) latestStatus = { ...latestStatus, mode };
  const label = modeLabel(mode);
  $('#modeLabel').textContent = label;
  const routingMode = $('#routingModeState');
  if (routingMode) routingMode.textContent = label;
  renderNodeGroupSwitcher();
  invalidatePageCache('routing');
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
  const count = Number(result?.count || 0);
  if (path) {
    setNotice(`日志已导出：${path}，共 ${count} 条`);
  } else {
    setNotice('没有可导出的日志');
  }
  return result;
}

async function exportDiagnosticReport() {
  return runBackgroundJob('exportDiagnostics', {}, {
    pendingNotice: '正在导出诊断报告...',
    successNotice: (value) => `诊断报告已导出：${value?.path || '-'}`,
    failureNotice: (err) => `诊断报告导出失败：${err.message || err}`
  });
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
      network: {
        lanIp: '-',
        proxyEndpoint: `127.0.0.1:${defaultMixedPort}`,
        outboundIp: '-',
        availability: {
          state: 'unverified',
          label: STATUS_TEXT.unchecked,
          detail: '无法读取运行状态，网络可用性未验证。'
        }
      },
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
      protection: { label: '未开启' },
      activeProfile: { name: 'Aegos 预设' }
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
  if (nodeBusy) {
    if (force) queuedNodeRefresh = { force, options };
    return;
  }
  if (!force && isForegroundHot()) return;
  if (!force && (foregroundBusy > 0 || backgroundJobBusy > 0)) return;
  const requestProfileSeq = profileStateSeq;
  nodeBusy = true;
  try {
    const groups = await invoke('proxy_groups');
    if (requestProfileSeq !== profileStateSeq) return;
    setLatestGroups(groups, selectedProxyGroupName);
    selectedNode = latestGroup?.now || selectedNode;
    scheduleRowsRender(latestGroup?.items || [], { force, target: options.target || 'all' });
  } catch {
    if (requestProfileSeq !== profileStateSeq) return;
    setLatestGroup(null);
    if (isNodeSurfaceActive()) renderRows();
    else pendingRowItems = [];
  } finally {
    nodeBusy = false;
    const queued = queuedNodeRefresh;
    queuedNodeRefresh = null;
    if (queued) void refreshNodes(queued.force, queued.options);
  }
}

async function refreshProfileSurfaces(options = {}) {
  await refreshStatus(true);
  await refreshNodes(true);
  renderProfiles();
  if (options.refreshOutboundIp && latestStatus?.trafficTakeover) {
    void refreshOutboundIpAfterNodeChange();
  }
}

async function previewProfileNodes(profileId) {
  const previewSeq = ++profilePreviewSeq;
  try {
    const groups = await invoke('preview_profile_groups', { id: profileId });
    const stillActive = latestStatus?.settings?.activeProfileId === profileId;
    if (previewSeq !== profilePreviewSeq || !stillActive) return;
    latestGroups = Array.isArray(groups) ? groups : [];
    const group = preferredProxyGroup(latestGroups, selectedProxyGroupName);
    if (!group || !Array.isArray(group.items) || !group.items.length) return;
    selectedProxyGroupName = group.name || '';
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
  profileStateSeq += 1;
  profilePreviewSeq += 1;
  stopSpeedTestPolling();
  latestSpeedStatus = null;
  lastAppliedSpeedSignature = '';
  lastSpeedNodeRefreshAt = 0;
  outboundIpRequestSeq += 1;
  outboundIpPendingSeq = 0;
  outboundIpLastStable = '-';
  setOutboundIpText('-');
  selectedNode = '';
  selectedProxyGroupName = '';
  latestGroups = [];
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
      setNotice(`测速中 ${status.completed || 0}/${status.total || 0}，成功 ${status.ok || 0}，失败 ${status.failed || 0}`);
      return;
    }
    await refreshVisibleNodesForSpeed(true);
    stopSpeedTestPolling();
    setNotice(`测速完成：成功 ${status.ok || 0}，失败 ${status.failed || 0}，共 ${status.total || 0} 个`);
  } catch (err) {
    stopSpeedTestPolling();
    setNotice(`测速状态获取失败：${err.message || err}`);
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
    setNotice(`操作失败：${err.message || err}`);
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
    outboundIpLastStable = '-';
    setOutboundIpText('\u67e5\u8be2\u5931\u8d25', lastBackgroundJobError || '\u65e0\u6cd5\u83b7\u53d6\u843d\u5730 IP');
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
      pendingNotice: showHealthyNotice ? 'Aegos 正在自检...' : '',
      progressNotice: (job) => showHealthyNotice && job?.message ? `${job.message}` : '',
      failureNotice: (err) => `操作失败：${err.message || err}`
    });
    await refreshStatus(true);
    await refreshNodes(true);
    if (!result) return null;
    if (result?.ok && result?.action === 'none') {
      if (showHealthyNotice) setNotice('网络状态良好');
      return result;
    }
    if (result?.action === 'observe') {
      if (showHealthyNotice) setNotice(`继续观察：${result.failures || 0}/${result.threshold || 0}`);
      return result;
    }
    const recovery = result?.result || {};
    if (result?.ok && result?.profileChanged) {
      setNotice(`已切换订阅：${result.profile?.name || '-'} / ${recovery.proxy || '-'}`);
      return result;
    }
    if (result?.ok) {
      setNotice(`自动切换到节点：${recovery.proxy || '-'} (${recovery.delay || '-'} ms)`);;
      return result;
    }
    setNotice(`自愈失败：${result?.probe?.reason || '没有可用节点'}`);
    return result;
  } finally {
    recoveryBusy = false;
  }
}

async function updateProfileJob(id) {
  return runBackgroundJob('updateProfile', { id }, {
    pendingNotice: '正在更新订阅...',
    successNotice: '已完成',
    failureNotice: (err) => `诊断报告导出失败：${err.message || err}`
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
    pendingNotice: '正在更新全部订阅...',
    successNotice: (result) => `全部订阅更新完成：成功 ${result?.updated?.length || 0}，失败 ${result?.failed?.length || 0}`,
    failureNotice: (err) => `诊断报告导出失败：${err.message || err}`
  });
}

async function addProfileUrlJob(url) {
  return runBackgroundJob('addProfileUrl', { url }, {
    pendingNotice: '正在导入订阅...',
    successNotice: '已添加',
    failureNotice: (err) => `诊断报告导出失败：${err.message || err}`
  });
}

async function setActiveProfileJob(id) {
  return runBackgroundJob('setActiveProfile', { id }, {
    pendingNotice: '正在切换订阅...',
    successNotice: '订阅已切换',
    failureNotice: (err) => `诊断报告导出失败：${err.message || err}`
  });
}

async function removeProfileJob(id) {
  return runBackgroundJob('removeProfile', { id }, {
    pendingNotice: '正在删除...',
    successNotice: '已删除',
    failureNotice: (err) => `删除失败：${err.message || err}`
  });
}

async function updateSettingsJob(updates) {
  return runBackgroundJob('updateSettings', { updates }, {
    pendingNotice: '正在处理...',
    successNotice: '已保存',
    failureNotice: (err) => `操作失败：${err.message || err}`
  });
}

async function repairSystemProxyJob() {
  const result = await runBackgroundJob('repairSystemProxy', {}, {
    pendingNotice: '正在修复系统代理...',
    successNotice: '系统代理已交给 Aegos',
    failureNotice: (err) => `系统代理修复失败：${err.message || err}`,
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
    progressNotice: (job) => job?.message ? `${job.label}${job.message}` : '',
    onSuccess: async () => {
      await refreshStatus(true);
      await refreshNodes(true);
      if (kind === 'startCore') void refreshOutboundIpAfterNodeChange();
    },
    successNotice: options.successNotice,
    failureNotice: options.failureNotice
  });
  if (!result) {
    const reason = lastBackgroundJobError || '核心操作失败';
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
    setNotice('当前没有可更新的远程订阅');
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
      await refreshProfileSurfaces({ refreshOutboundIp: true });
    },
    pendingNotice: '正在更新当前订阅...',
    successNotice: '订阅已更新',
    failureNotice: (err) => `订阅更新失败：${err.message || err}`
  });
}

async function toggleCore() {
  const button = $('#connectBtn');
  if (button?.dataset.busy === 'true') return;
  const stopping = Boolean(latestStatus?.trafficTakeover);
  corePowerPendingKind = stopping ? 'stopCore' : 'startCore';
  if (button) button.textContent = connectionButtonLabel(latestStatus, corePowerPendingKind);
  setButtonBusy(button, true, '', { preserveContent: true });
  try {
    setNotice(stopping ? '正在断开连接...' : '正在建立连接...');
    await corePowerJob(stopping ? 'stopCore' : 'startCore', {
      pendingNotice: stopping ? '正在后台断开连接...' : '正在后台建立连接...',
      successNotice: stopping ? '已断开连接' : '已连接，正在刷新落地 IP',
      failureNotice: (err) => `核心操作失败：${err.message || err}`
    });
    setNotice(latestStatus?.trafficTakeover ? '已连接，正在刷新落地 IP' : '已断开连接');
  } catch (err) {
    setNotice(`操作失败：${err.message || err}`);
  } finally {
    corePowerPendingKind = '';
    setButtonBusy(button, false, '', { preserveContent: true });
    if (latestStatus) renderStatus(latestStatus);
    else if (button) button.textContent = connectionButtonLabel({ trafficTakeover: false }, '');
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
    pendingNotice: '正在处理...',
    successNotice: '',
    failureNotice: (err) => `操作失败：${err.message || err}`
  });
}

async function applyMode(mode) {
  $('#modeMenu').classList.add('hidden');
  await runOptimisticAction({
    apply: () => applyOptimisticMode(mode),
    commit: () => runBackgroundJob('setMode', { mode }, {
      pendingNotice: '正在切换模式...',
    failureNotice: (err) => `诊断报告导出失败：${err.message || err}`
    }),
    refresh: () => refreshStatus(true),
      pendingNotice: '正在切换模式...',
    successNotice: '模式已切换',
    failureNotice: (err) => `诊断报告导出失败：${err.message || err}`
  });
}

async function selectNode(name, groupOverride = '') {
  if (!name) return;
  const groupName = groupOverride || activeBackendProxyGroupName();
  if (!groupName || !latestStatus?.running) {
    applyOptimisticNode(name);
    setNotice(`已选择节点：${name}`);
    return;
  }
  await runOptimisticAction({
    apply: () => applyOptimisticNode(name),
    commit: () => runBackgroundJob('changeProxy', { group: groupName, proxy: name }, {
      pendingNotice: '正在切换模式...',
    failureNotice: (err) => `诊断报告导出失败：${err.message || err}`
    }),
    refresh: async (result) => {
      await refreshNodes(true, { target: 'nodes' });
      if (result) void refreshOutboundIpAfterNodeChange();
    },
      pendingNotice: '正在切换模式...',
    successNotice: (result) => result ? `已切换节点：${name}` : '',
    failureNotice: (err) => `诊断报告导出失败：${err.message || err}`
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
  const timeoutResult = { ...lastResult, delay: -1, reason: lastResult.reason || 'timeout' };
  applyOptimisticNodeDelay(name, -1, timeoutResult.reason);
  return timeoutResult;
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
    setNotice(`操作失败：${err.message || err}`);
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
  const group = activeBackendProxyGroupName();
  const proxy = latestGroup?.now || selectedNode || '';
  if (!group || !proxy) {
    setNotice('没有可锁定的节点');
    return;
  }
  if (!isAutoStrategyGroup(latestGroup)) {
    setNotice('没有可锁定的节点');
    return;
  }
  await runOptimisticAction({
    apply: () => applyOptimisticNode(proxy),
    commit: () => runBackgroundJob('changeProxy', { group, proxy }, {
      pendingNotice: '正在切换节点...',
    failureNotice: (err) => `诊断报告导出失败：${err.message || err}`
    }),
    refresh: async (result) => {
      await refreshNodes(true);
      if (result) void refreshOutboundIpAfterNodeChange();
    },
      pendingNotice: '正在锁定节点...',
    successNotice: (result) => result ? `已锁定节点：${proxy}` : '',
    failureNotice: (err) => `诊断报告导出失败：${err.message || err}`
  });
}

async function updateSetting(key, value) {
  if (value && ['tunEnabled', 'killSwitchEnabled'].includes(key) && !latestStatus?.permissions?.isAdmin) {
    await refreshStatus(true);
    setNotice('TUN 或断网保护需要管理员权限，请以管理员身份运行 Aegos');
    return;
  }
  await runOptimisticAction({
    apply: () => applyOptimisticSetting(key, value),
    commit: () => runBackgroundJob('updateSetting', { key, value }, {
      pendingNotice: '正在切换模式...',
    failureNotice: (err) => `诊断报告导出失败：${err.message || err}`
    }),
    refresh: async () => {
      await refreshStatus(true);
      await refreshNodes(true);
    },
      pendingNotice: '正在切换模式...',
    successNotice: '设置已保存',
    failureNotice: (err) => `操作失败：${err.message || err}`
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
        el('span', { className: 'connection-actions' }, [
          el('button', { dataset: { routingDraftTarget: target }, textContent: '\u8349\u7a3f' }),
          el('button', { dataset: { closeConnection: item.id }, textContent: '\u5173\u95ed' })
        ])
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

function routingStrategyTypeLabel(kind = '') {
  const value = String(kind || '').replace(/[\s_-]/g, '').toLowerCase();
  if (value === 'select') return '\u624b\u52a8\u9009\u62e9';
  if (value === 'urltest') return '\u81ea\u52a8\u6d4b\u901f';
  if (value === 'fallback') return '\u6545\u969c\u5207\u6362';
  if (value === 'loadbalance') return '\u8d1f\u8f7d\u5747\u8861';
  return kind ? String(kind) : '-';
}

function normalizeShellStaticText() {
  navButtons.forEach((button, page) => {
    const label = pageNames[page] || page;
    const currentIcon = button.querySelector('.aegos-icon');
    const iconNode = currentIcon || icon(`icon-${page}`);
    button.replaceChildren(iconNode, text(label));
  });
  const nodesTitle = document.querySelector('[data-page-panel="nodes"] .table-head .node-profile-switch');
  if (nodesTitle) nodesTitle.lastChild && (nodesTitle.lastChild.textContent = '\u5207\u6362\u8ba2\u9605');
}

function normalizeRoutingStaticText() {
  const panel = document.querySelector('[data-page-panel="routing"]');
  if (!panel) return;
  const title = panel.querySelector('.section-head h2');
  const subtitle = panel.querySelector('.section-head p');
  if (title) title.textContent = '\u89c4\u5219';
  if (subtitle) subtitle.textContent = '\u4e0d\u7528\u5199 YAML\uff1a\u6307\u5b9a\u54ea\u4e2a\u7f51\u7ad9\u6216\u5e94\u7528\u8d70\u54ea\u6761\u7ebf\u8def\uff0c\u7cfb\u7edf\u89c4\u5219\u53ea\u8bfb\u4e14\u4f1a\u8bf4\u660e\u7528\u9014\u3002';
  const badge = $('#routingReadonlyBadge');
  if (badge) badge.textContent = '\u5b89\u5168\u9884\u89c8\uff0c\u4e0d\u6539\u914d\u7f6e';
  const refresh = $('#refreshRoutingBtn');
  if (refresh) refresh.textContent = '\u5237\u65b0';
  const summaryLabels = panel.querySelectorAll('.routing-summary article span');
  const summaryKinds = ['mode', 'groups', 'user', 'system'];
  ['\u5f53\u524d\u6a21\u5f0f', '\u7b56\u7565\u7ec4', '\u6211\u7684\u89c4\u5219', '\u53ea\u8bfb\u89c4\u5219'].forEach((label, index) => {
    if (summaryLabels[index]) summaryLabels[index].textContent = label;
    const card = summaryLabels[index]?.closest('article');
    if (card) {
      card.classList.add('routing-summary-card');
      card.dataset.routingSummary = summaryKinds[index] || '';
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
    }
  });
  const tables = panel.querySelectorAll('.connection-table');
  if (tables[0]) {
    tables[0].classList.add('routing-table-card', 'routing-group-table');
    const head = tables[0].querySelector('.simple-row.head');
    if (head) {
      head.className = 'routing-row routing-row-head routing-group-row';
      replaceChildrenSafe(head, ['\u540d\u79f0', '\u7c7b\u578b', '\u5f53\u524d\u9009\u62e9', '\u6570\u91cf', '\u8bf4\u660e'].map((label) => el('span', { textContent: label })));
    }
  }
  if (tables[1]) {
    tables[1].classList.add('routing-table-card', 'routing-rule-table');
    const head = tables[1].querySelector('.simple-row.head');
    if (head) {
      head.className = 'routing-row routing-row-head routing-rule-row';
      replaceChildrenSafe(head, ['\u7c7b\u578b', '\u6761\u4ef6', '\u76ee\u6807', '\u72b6\u6001'].map((label) => el('span', { textContent: label })));
    }
  }
  if (tables[0] && tables[1] && !$('#routingAdvancedPanel')) {
    const advanced = el('details', { id: 'routingAdvancedPanel', className: 'routing-advanced-panel' }, [
      el('summary', { className: 'routing-advanced-summary' }, [
        el('span', {}, [
          el('b', { textContent: '\u914d\u7f6e\u89c4\u5219\u660e\u7ec6' }),
          el('small', { textContent: '\u8fd9\u91cc\u662f\u8ba2\u9605\u548c Aegos \u751f\u6210\u7684\u5e95\u5c42\u89c4\u5219\uff0c\u666e\u901a\u7528\u6237\u901a\u5e38\u4e0d\u9700\u8981\u9010\u6761\u67e5\u770b\u3002' })
        ]),
        el('em', { textContent: '\u5c55\u5f00' })
      ])
    ]);
    tables[0].before(advanced);
    advanced.append(
      el('div', { className: 'routing-advanced-note' }, [
        el('b', { textContent: '\u600e\u4e48\u7406\u89e3\u8fd9\u4e9b\u89c4\u5219\uff1f' }),
        el('small', { textContent: '\u4e3b\u754c\u9762\u4f18\u5148\u770b\u201c\u7528\u6237\u89c4\u5219\u201d\u548c\u8349\u7a3f\u3002\u672c\u533a\u4e3b\u8981\u7528\u4e8e\u6392\u67e5\uff1a\u7528\u6237\u89c4\u5219\u4f18\u5148\uff0c\u5177\u4f53\u7f51\u7ad9/\u5e94\u7528\u4f18\u5148\u4e8e\u573a\u666f\uff0c\u573a\u666f\u4f18\u5148\u4e8e\u8ba2\u9605\u515c\u5e95\u89c4\u5219\u3002' })
      ]),
      tables[0],
      tables[1]
    );
  }
}

function ensureRoutingAssistantUi() {
  if (routingAssistantReady) return;
  const summary = document.querySelector('[data-page-panel="routing"] .routing-summary');
  if (!summary) return;
  const autoCount = $('#routingAutoCount');
  if (autoCount) autoCount.id = 'routingSystemRuleCount';
  normalizeRoutingStaticText();
  const actionOptions = () => [
    el('option', { textContent: '\u8d70\u4ee3\u7406', attrs: { value: 'proxy' } }),
    el('option', { textContent: '\u76f4\u8fde', attrs: { value: 'direct' } }),
    el('option', { textContent: '\u62d2\u7edd', attrs: { value: 'reject' } })
  ];
  const targetField = (id) => el('label', { className: 'routing-field routing-proxy-target-field' }, [
    el('span', { textContent: '\u4f7f\u7528\u7ebf\u8def' }),
    el('select', { id, attrs: { 'aria-label': '\u4f7f\u7528\u7ebf\u8def' } }, [])
  ]);
  const kindButton = (kind, title, detail) => el('button', {
    className: kind === routingAssistantKind ? 'active' : '',
    dataset: { routingKind: kind },
    attrs: { type: 'button' }
  }, [
    el('b', { textContent: title }),
    el('small', { textContent: detail })
  ]);
  const panelHeader = (title, detail) => el('div', { className: 'routing-panel-title' }, [
    el('b', { textContent: title }),
    el('small', { textContent: detail })
  ]);
  const systemEntry = (title, detail) => el('div', { className: 'routing-system-entry' }, [
    el('b', { textContent: title }),
    el('small', { textContent: detail })
  ]);
  const assistant = el('div', {
    className: 'routing-assistant',
    dataset: { view: routingAssistantView, kind: routingAssistantKind },
    attrs: { 'aria-label': '\u5206\u6d41\u89c4\u5219\u8349\u7a3f\u9884\u89c8' }
  }, [
    el('div', { className: 'routing-assistant-head' }, [
      el('div', {}, [
        el('h3', { textContent: '\u6dfb\u52a0\u7f51\u7ad9\u6216\u5e94\u7528\u89c4\u5219' }),
        el('p', { textContent: '\u9009\u4e00\u4e2a\u5165\u53e3\uff0c\u5148\u751f\u6210\u672a\u751f\u6548\u8349\u7a3f\uff0c\u518d\u9a8c\u8bc1\uff0c\u6700\u540e\u7531\u4f60\u786e\u8ba4\u5e94\u7528\u3002' })
      ]),
      el('div', { className: 'routing-safety-strip' }, [
        el('span', { textContent: '\u9884\u89c8\u4e0d\u6539\u914d\u7f6e' }),
        el('span', { textContent: '\u9a8c\u8bc1\u4e0d\u5207\u8282\u70b9' }),
        el('span', { textContent: '\u5e94\u7528\u53ef\u64a4\u9500' })
      ])
    ]),
    el('div', { className: 'routing-builder' }, [
      el('nav', { className: 'routing-kind-list', attrs: { 'aria-label': '\u9009\u62e9\u89c4\u5219\u5165\u53e3' } }, [
        kindButton('website', '\u7f51\u7ad9\u89c4\u5219', '\u8f93\u5165 youtube.com \u8fd9\u7c7b\u57df\u540d'),
        kindButton('app', '\u5e94\u7528\u89c4\u5219', '\u9009\u62e9 Telegram.exe \u8fd9\u7c7b\u7a0b\u5e8f'),
        kindButton('system', '\u7cfb\u7edf\u89c4\u5219', '\u67e5\u770b Aegos \u81ea\u52a8\u7ef4\u62a4\u7684\u89c4\u5219')
      ]),
      el('section', { className: 'routing-builder-panel is-active', id: 'routingPanelWebsite', dataset: { routingPanel: 'website' } }, [
        panelHeader('\u7f51\u7ad9\u5206\u6d41', '\u8f93\u5165\u57df\u540d\uff0cAegos \u4f1a\u751f\u6210\u672a\u751f\u6548\u8349\u7a3f\u3002'),
        el('label', { className: 'routing-field' }, [
          el('span', { textContent: '\u76ee\u6807\u7f51\u7ad9' }),
          el('input', { id: 'routingWebsiteInput', attrs: { placeholder: 'example.com', autocomplete: 'off', spellcheck: 'false' } })
        ]),
        el('div', { className: 'routing-draft-form' }, [
          el('label', { className: 'routing-field' }, [
            el('span', { textContent: '\u8d70\u5411' }),
            el('select', { id: 'routingWebsiteAction', attrs: { 'aria-label': '\u8d70\u5411' } }, actionOptions())
          ]),
          targetField('routingWebsiteTargetSelect'),
          el('button', { id: 'previewWebsiteRuleBtn', className: 'primary compact', attrs: { type: 'button' }, textContent: '\u751f\u6210\u8349\u7a3f' })
        ]),
        el('p', { id: 'routingDraftPreview', className: 'routing-draft-preview', textContent: '\u7b49\u5f85\u8f93\u5165\u7f51\u7ad9\u3002' })
      ]),
      el('section', { className: 'routing-builder-panel', id: 'routingPanelApp', dataset: { routingPanel: 'app' } }, [
        panelHeader('\u5e94\u7528\u5206\u6d41', '\u7528\u8fdb\u7a0b\u540d\u5339\u914d\uff0c\u540d\u79f0\u4e0d\u5bf9\u65f6\u53ef\u80fd\u4e0d\u751f\u6548\u3002'),
        el('label', { className: 'routing-field' }, [
          el('span', { textContent: '\u5e94\u7528\u8fdb\u7a0b' }),
          el('input', { id: 'routingAppInput', attrs: { placeholder: 'Telegram.exe', autocomplete: 'off', spellcheck: 'false' } })
        ]),
        el('div', { className: 'routing-draft-form' }, [
          el('label', { className: 'routing-field' }, [
            el('span', { textContent: '\u8d70\u5411' }),
            el('select', { id: 'routingAppAction', attrs: { 'aria-label': '\u8d70\u5411' } }, actionOptions())
          ]),
          targetField('routingAppTargetSelect'),
          el('button', { id: 'previewAppRuleBtn', className: 'primary compact', attrs: { type: 'button' }, textContent: '\u751f\u6210\u8349\u7a3f' })
        ]),
        el('p', { id: 'routingAppDraftPreview', className: 'routing-draft-preview', textContent: '\u7b49\u5f85\u8f93\u5165\u5e94\u7528\u3002' })
      ]),
      el('section', { className: 'routing-builder-panel', id: 'routingPanelSystem', dataset: { routingPanel: 'system' } }, [
        panelHeader('\u7cfb\u7edf\u89c4\u5219', '\u8fd9\u4e9b\u89c4\u5219\u7531 Aegos \u81ea\u52a8\u7ef4\u62a4\uff0c\u7528\u6765\u4fdd\u8bc1\u68c0\u6d4b\u3001\u8bca\u65ad\u548c\u9632\u6cc4\u9732\u884c\u4e3a\u53ef\u63a7\u3002'),
        el('div', { className: 'routing-system-entry-grid' }, [
          systemEntry('\u843d\u5730 IP \u67e5\u8be2', '\u8ba9 IP \u68c0\u6d4b\u8d70\u5f53\u524d\u8282\u70b9\uff0c\u4e0d\u6539\u53d8\u4f60\u7684\u8fde\u63a5\u3002'),
          systemEntry('Aegos \u81ea\u8eab\u670d\u52a1', '\u4fdd\u8bc1\u8ba2\u9605\u3001\u8bca\u65ad\u3001\u72b6\u6001\u67e5\u8be2\u80fd\u88ab\u8bc6\u522b\u548c\u89e3\u91ca\u3002'),
          systemEntry('\u9632\u6cc4\u9732\u4fdd\u62a4', '\u9632\u6b62\u68c0\u6d4b\u6216\u7cfb\u7edf\u63a5\u7ba1\u65f6\u51fa\u73b0\u4e0d\u53ef\u89c1\u7684\u7ed5\u8fc7\u3002')
        ]),
        el('p', { id: 'routingSystemEntryHint', className: 'routing-draft-preview ok', textContent: '\u7cfb\u7edf\u89c4\u5219\u53ea\u8bfb\uff0c\u4e0d\u4f1a\u8981\u6c42\u4f60\u624b\u52a8\u7f16\u8f91\uff1b\u5982\u679c\u5f71\u54cd\u7528\u6237\u89c4\u5219\uff0cAegos \u4f1a\u8bf4\u660e\u539f\u56e0\u3002' }),
        el('button', { id: 'routingShowSystemRulesBtn', className: 'ghost compact', attrs: { type: 'button' }, textContent: '\u67e5\u770b\u7cfb\u7edf\u89c4\u5219\u660e\u7ec6' })
      ])
    ]),
    el('section', { id: 'routingDraftListCard', className: 'routing-draft-card routing-draft-list-card' }, [
      el('div', { className: 'routing-draft-head' }, [
        el('div', {}, [
          el('b', { textContent: '\u8349\u7a3f\u4e0e\u9a8c\u8bc1' }),
          el('small', { id: 'routingDraftListHint', textContent: '\u8349\u7a3f\u672a\u5e94\u7528\u524d\u4e0d\u4f1a\u6539\u914d\u7f6e\uff1b\u5e94\u7528\u524d\u4f1a\u5148\u9884\u68c0\uff0c\u5931\u8d25\u4f1a\u56de\u6eda\u3002' })
        ])
      ]),
      el('div', { id: 'routingDraftList', className: 'routing-draft-list' }, []),
      el('p', { id: 'routingConflictSummary', className: 'routing-draft-preview', textContent: '\u6682\u65e0\u8349\u7a3f\u3002' }),
      el('div', { className: 'routing-draft-actions' }, [
        el('button', { id: 'undoRoutingDraftBtn', className: 'ghost compact', attrs: { type: 'button' }, textContent: '\u64a4\u9500\u4e0a\u4e00\u6761' }),
        el('button', { id: 'verifyAllRoutingDraftsBtn', className: 'ghost compact', attrs: { type: 'button' }, textContent: '\u9a8c\u8bc1\u5168\u90e8' }),
        el('button', { id: 'applyRoutingDraftsBtn', className: 'primary compact', attrs: { type: 'button' }, textContent: '\u5e94\u7528\u8349\u7a3f' }),
        el('button', { id: 'undoRoutingApplyBtn', className: 'ghost compact', attrs: { type: 'button' }, textContent: '\u64a4\u9500\u6700\u8fd1\u5e94\u7528' })
      ])
    ]),
    el('section', { id: 'routingApplyStatus', className: 'routing-apply-status hidden', attrs: { 'aria-live': 'polite' } }, [])
  ]);
  const detail = el('section', {
    id: 'routingSummaryDetail',
    className: 'routing-summary-detail',
    attrs: { 'aria-live': 'polite' }
  }, []);
  summary.after(detail, assistant);
  $('#previewWebsiteRuleBtn')?.addEventListener('click', previewWebsiteRoutingDraft);
  $('#previewAppRuleBtn')?.addEventListener('click', previewAppRoutingDraft);
  $('#routingShowSystemRulesBtn')?.addEventListener('click', () => setRoutingSummaryDetail('system'));
  $('#undoRoutingDraftBtn')?.addEventListener('click', undoLastRoutingDraft);
  $('#verifyAllRoutingDraftsBtn')?.addEventListener('click', verifyAllRoutingDrafts);
  $('#applyRoutingDraftsBtn')?.addEventListener('click', (event) => runDetachedButtonAction(event.currentTarget, '\u5e94\u7528\u4e2d...', applyRoutingDrafts));
  $('#undoRoutingApplyBtn')?.addEventListener('click', (event) => runDetachedButtonAction(event.currentTarget, '\u64a4\u9500\u4e2d...', undoLastRoutingApply));
  $('#routingWebsiteAction')?.addEventListener('change', syncRoutingProxyTargetFields);
  $('#routingAppAction')?.addEventListener('change', syncRoutingProxyTargetFields);
  document.querySelectorAll('[data-routing-summary]').forEach((card) => {
    const activate = () => setRoutingSummaryDetail(card.dataset.routingSummary || 'system');
    card.addEventListener('click', activate);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    });
  });
  document.querySelectorAll('[data-routing-kind]').forEach((button) => {
    button.addEventListener('click', () => setRoutingAssistantKind(button.dataset.routingKind || 'website'));
  });
  $('#routingWebsiteInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') previewWebsiteRoutingDraft();
  });
  $('#routingAppInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') previewAppRoutingDraft();
  });
  refreshRoutingTargetOptions();
  syncRoutingProxyTargetFields();
  setRoutingSummaryDetail(routingSummaryDetail);
  renderRoutingDraftList();
  renderRoutingApplyStatus();
  routingAssistantReady = true;
}

function routingDraftAction(action = 'proxy', targetOverride = '') {
  const proxyTarget = String(targetOverride || '').trim() || routingProxyTargetOptions()[0]?.value || 'Proxies';
  const actionMap = {
    proxy: { label: `\u8d70 ${routingTargetLabel(proxyTarget)}`, target: proxyTarget },
    direct: { label: '\u76f4\u8fde', target: 'DIRECT' },
    reject: { label: '\u62d2\u7edd', target: 'REJECT' }
  };
  return actionMap[action] || actionMap.proxy;
}

function routingRuleKey(draft = {}) {
  return `${String(draft.kind || '').toUpperCase()}|${String(draft.condition || '').toLowerCase()}`;
}

function existingRoutingRules() {
  return Array.isArray(latestRoutingSnapshot?.rules) ? latestRoutingSnapshot.rules : [];
}

function routingTargetOptions() {
  const groups = Array.isArray(latestRoutingSnapshot?.groups) ? latestRoutingSnapshot.groups : [];
  const nodes = Array.isArray(latestGroup?.items) ? latestGroup.items : [];
  const options = [
    { label: '\u4e3b\u8981\u4ee3\u7406\u7ec4', value: groups[0]?.name || 'Proxies', kind: 'group' },
    { label: '\u76f4\u8fde', value: 'DIRECT' },
    { label: '\u62d2\u7edd', value: 'REJECT' }
  ];
  groups.slice(0, 12).forEach((group) => {
    const name = String(group.name || '').trim();
    if (name && !options.some((item) => item.value === name)) {
      options.push({ label: name, value: name, kind: 'group' });
    }
  });
  const current = selectedNode || latestGroup?.now || '';
  if (current && !options.some((item) => item.value === current)) {
    options.push({ label: `\u5f53\u524d\u8282\u70b9\uff1a${current}`, value: current, kind: 'node' });
  }
  nodes.slice(0, 80).forEach((node) => {
    const name = String(node?.name || node?.realProxyName || '').trim();
    if (!name || options.some((item) => item.value === name)) return;
    const prefix = isFixedNodeItem(node)
      ? '\u56fa\u5b9a\u8282\u70b9'
      : favoriteNodes.has(name)
        ? '\u6536\u85cf\u8282\u70b9'
        : '\u8282\u70b9';
    options.push({ label: `${prefix}\uff1a${name}`, value: name, kind: 'node' });
  });
  return options;
}

function routingProxyTargetOptions() {
  return routingTargetOptions().filter((item) => !['DIRECT', 'REJECT'].includes(item.value));
}

function refreshRoutingTargetOptions() {
  [
    { selector: '#routingTargetSelect', options: routingProxyTargetOptions() },
    { selector: '#routingWebsiteTargetSelect', options: routingProxyTargetOptions() },
    { selector: '#routingAppTargetSelect', options: routingProxyTargetOptions() }
  ].forEach(({ selector, options }) => {
    const targetSelect = $(selector);
    if (!targetSelect) return;
    const current = targetSelect.value;
    const optionEls = (options.length ? options : [{ label: '\u4e3b\u8981\u4ee3\u7406\u7ec4', value: 'Proxies' }])
      .map((item) => el('option', { textContent: item.label, attrs: { value: item.value } }));
    replaceChildrenSafe(targetSelect, optionEls);
    if ([...targetSelect.options].some((option) => option.value === current)) targetSelect.value = current;
  });
  syncRoutingProxyTargetFields();
}

function syncRoutingProxyTargetFields() {
  [
    { action: '#routingWebsiteAction', field: '#routingWebsiteTargetSelect' },
    { action: '#routingAppAction', field: '#routingAppTargetSelect' }
  ].forEach(({ action, field }) => {
    const select = $(field);
    const wrapper = select?.closest('.routing-proxy-target-field');
    if (!select || !wrapper) return;
    const show = ($(action)?.value || 'proxy') === 'proxy';
    wrapper.classList.toggle('hidden', !show);
  });
}

function classifyRoutingDraft(draft = {}) {
  const key = routingRuleKey(draft);
  const existing = existingRoutingRules().find((item) => routingRuleKey({ kind: item.kind, condition: item.condition }) === key);
  const duplicateDraft = routingAssistantDrafts.find((item) => item.id !== draft.id && routingRuleKey(item) === key);
  if (existing && String(existing.target || '') !== String(draft.target || '')) {
    return { level: 'warn', text: `\u5df2\u6709\u76f8\u540c\u6761\u4ef6\u6307\u5411 ${routingTargetLabel(existing.target)}\uff0c\u65b0\u76ee\u6807\u662f ${routingTargetLabel(draft.target)}\u3002\u7528\u6237\u89c4\u5219\u4f1a\u4f18\u5148\uff0c\u5efa\u8bae\u786e\u8ba4\u540e\u518d\u5e94\u7528\u3002` };
  }
  if (existing) return { level: 'ok', text: '\u5df2\u6709\u76f8\u540c\u751f\u6548\u89c4\u5219\uff0c\u4e0d\u9700\u8981\u91cd\u590d\u5e94\u7528\u3002' };
  if (duplicateDraft) return { level: 'warn', text: '\u8349\u7a3f\u4e2d\u5df2\u6709\u76f8\u540c\u6761\u4ef6\uff0c\u5efa\u8bae\u5148\u64a4\u9500\u91cd\u590d\u9879\u3002' };
  return { level: 'ok', text: '\u672a\u53d1\u73b0\u76f4\u63a5\u51b2\u7a81\uff0c\u7528\u6237\u89c4\u5219\u4f1a\u4f18\u5148\u4e8e\u573a\u666f\u548c\u8ba2\u9605\u515c\u5e95\u89c4\u5219\u3002' };
}

function addRoutingDraft(draft) {
  const item = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: Date.now(),
    verified: false,
    ...draft
  };
  item.rule = `${item.kind},${item.condition},${item.target}${item.option ? `,${item.option}` : ''}`;
  item.classification = classifyRoutingDraft(item);
  routingAssistantDrafts = [item, ...routingAssistantDrafts].slice(0, 12);
  renderRoutingDraftList();
  return item;
}

function verifyRoutingDraft(id) {
  routingAssistantDrafts = routingAssistantDrafts.map((item) => {
    if (item.id !== id) return item;
    const classification = classifyRoutingDraft(item);
    return {
      ...item,
      verified: true,
      classification,
      verifiedAt: Date.now()
    };
  });
  renderRoutingDraftList();
}

function removeRoutingDraft(id) {
  routingAssistantDrafts = routingAssistantDrafts.filter((item) => item.id !== id);
  if (expandedRoutingDraftId === id) expandedRoutingDraftId = '';
  renderRoutingDraftList();
}

function undoLastRoutingDraft() {
  if (routingAssistantDrafts[0]?.id === expandedRoutingDraftId) expandedRoutingDraftId = '';
  routingAssistantDrafts = routingAssistantDrafts.slice(1);
  renderRoutingDraftList();
}

function verifyAllRoutingDrafts() {
  routingAssistantDrafts = routingAssistantDrafts.map((item) => ({
    ...item,
    verified: true,
    classification: classifyRoutingDraft(item),
    verifiedAt: Date.now()
  }));
  renderRoutingDraftList();
  setNotice(routingAssistantDrafts.length ? '\u5206\u6d41\u8349\u7a3f\u5df2\u9a8c\u8bc1\u3002' : '\u6682\u65e0\u5206\u6d41\u8349\u7a3f\u9700\u8981\u9a8c\u8bc1\u3002');
}

function routingDraftPayload(item = {}) {
  return {
    kind: item.kind || '',
    condition: item.condition || '',
    target: item.target || '',
    option: item.option || '',
    label: item.label || '',
    source: item.source || 'draft'
  };
}

function renderRoutingApplyStatus() {
  const box = $('#routingApplyStatus');
  if (!box) return;
  if (!routingApplyStatus) {
    box.classList.add('hidden');
    replaceChildrenSafe(box, []);
    return;
  }
  box.classList.remove('hidden');
  const ok = routingApplyStatus.state !== 'error';
  const title = {
    applied: '\u5df2\u5e94\u7528',
    undone: '\u5df2\u64a4\u9500',
    error: '\u5e94\u7528\u5931\u8d25'
  }[routingApplyStatus.state] || '\u89c4\u5219\u72b6\u6001';
  const detail = routingApplyStatus.detail || (ok
    ? '\u72b6\u6001\u5df2\u540c\u6b65\uff0c\u53ef\u4ee5\u7ee7\u7eed\u521b\u5efa\u6216\u64a4\u9500\u89c4\u5219\u3002'
    : '\u672a\u5199\u5165\u914d\u7f6e\u6216\u5df2\u81ea\u52a8\u56de\u6eda\uff0c\u8bf7\u67e5\u770b\u539f\u56e0\u540e\u518d\u8bd5\u3002');
  replaceChildrenSafe(box, [
    el('div', { className: ok ? 'ok' : 'warn' }, [
      el('b', { textContent: title }),
      el('small', { textContent: detail })
    ]),
    el('div', { className: 'routing-apply-facts' }, [
      el('span', { textContent: `\u8ba2\u9605\uff1a${routingApplyStatus.profileName || '-'}` }),
      el('span', { textContent: `\u89c4\u5219\uff1a${routingApplyStatus.appliedCount ?? 0} \u6761` }),
      el('span', { textContent: routingApplyStatus.rollbackAvailable ? '\u53ef\u64a4\u9500' : '\u5df2\u65e0\u64a4\u9500\u9879' })
    ])
  ]);
}

async function applyRoutingDrafts() {
  if (!routingAssistantDrafts.length) {
    setNotice('\u8bf7\u5148\u751f\u6210\u89c4\u5219\u8349\u7a3f\u3002');
    return null;
  }
  verifyAllRoutingDrafts();
  const result = await runBackgroundJob('applyRoutingDrafts', {
    drafts: routingAssistantDrafts.map(routingDraftPayload)
  }, {
    pendingNotice: '\u6b63\u5728\u540e\u53f0\u9884\u68c0\u5e76\u5e94\u7528\u89c4\u5219\u8349\u7a3f...',
    successNotice: (value) => `\u89c4\u5219\u5df2\u5e94\u7528\uff1a${value?.appliedCount || 0} \u6761`,
    failureNotice: (err) => `\u89c4\u5219\u5e94\u7528\u5931\u8d25\uff1a${err.message || err}`
  });
  if (!result) {
    routingApplyStatus = {
      state: 'error',
      profileName: latestRoutingSnapshot?.lastApply?.profileName || '',
      appliedCount: 0,
      rollbackAvailable: Boolean(latestRoutingSnapshot?.lastApply?.rollbackAvailable),
      detail: `\u539f\u56e0\uff1a${lastBackgroundJobError || '\u672a\u77e5'}\u3002\u5982\u679c\u5df2\u5199\u5165\u534a\u9014\u5931\u8d25\uff0cAegos \u4f1a\u5c1d\u8bd5\u81ea\u52a8\u56de\u6eda\uff1b\u8bf7\u67e5\u770b\u65e5\u5fd7\u6216\u5148\u64a4\u9500\u6700\u8fd1\u5e94\u7528\u3002`
    };
    renderRoutingApplyStatus();
    return null;
  }
  routingApplyStatus = {
    state: 'applied',
    profileName: result.profileName || '',
    appliedCount: result.appliedCount || 0,
    rollbackAvailable: Boolean(result.rollbackAvailable),
    detail: `\u5df2\u5b89\u5168\u5199\u5165\u5e76\u5b8c\u6210\u9884\u68c0\uff1a${result.appliedCount || 0} \u6761\u89c4\u5219\u3002\u5982\u679c\u7f51\u7edc\u8868\u73b0\u4e0d\u5bf9\uff0c\u53ef\u4ee5\u70b9\u51fb\u201c\u64a4\u9500\u6700\u8fd1\u5e94\u7528\u201d\u6062\u590d\u3002`
  };
  routingAssistantDrafts = [];
  renderRoutingDraftList();
  renderRoutingApplyStatus();
  await refreshRoutingSnapshot();
  return result;
}

async function undoLastRoutingApply() {
  const result = await runBackgroundJob('undoRoutingApply', {}, {
    pendingNotice: '\u6b63\u5728\u540e\u53f0\u64a4\u9500\u6700\u8fd1\u4e00\u6b21\u89c4\u5219\u5e94\u7528...',
    successNotice: '\u5df2\u64a4\u9500\u6700\u8fd1\u4e00\u6b21\u89c4\u5219\u5e94\u7528\u3002',
    failureNotice: (err) => `\u89c4\u5219\u64a4\u9500\u5931\u8d25\uff1a${err.message || err}`
  });
  if (!result) {
    routingApplyStatus = {
      state: 'error',
      profileName: latestRoutingSnapshot?.lastApply?.profileName || '',
      appliedCount: latestRoutingSnapshot?.lastApply?.appliedCount || 0,
      rollbackAvailable: Boolean(latestRoutingSnapshot?.lastApply?.rollbackAvailable),
      detail: `\u539f\u56e0\uff1a${lastBackgroundJobError || '\u672a\u77e5'}\u3002\u8bf7\u4fdd\u6301\u5f53\u524d\u8ba2\u9605\u4e0d\u53d8\uff0c\u518d\u8bd5\u4e00\u6b21\u6216\u67e5\u770b\u65e5\u5fd7\u3002`
    };
    renderRoutingApplyStatus();
    return null;
  }
  if (result) {
    routingApplyStatus = {
      state: 'undone',
      profileName: result.profileName || '',
      appliedCount: 0,
      rollbackAvailable: false,
      detail: '\u6700\u8fd1\u4e00\u6b21\u89c4\u5219\u5e94\u7528\u5df2\u6062\u590d\u5230\u539f\u914d\u7f6e\uff0c\u64a4\u9500\u5907\u4efd\u5df2\u6e05\u7406\u3002'
    };
    renderRoutingApplyStatus();
    await refreshRoutingSnapshot();
  }
  return result;
}

function setRoutingSummaryDetail(kind = 'system') {
  routingSummaryDetail = ['mode', 'groups', 'user', 'system'].includes(kind) ? kind : 'system';
  document.querySelectorAll('[data-routing-summary]').forEach((card) => {
    card.classList.toggle('active', card.dataset.routingSummary === routingSummaryDetail);
  });
  renderRoutingSummaryDetail();
}

function routingRuleCategory(item = {}) {
  const source = String(item.source || '').toLowerCase();
  const condition = String(item.condition || '');
  if (source === 'draft' || source === 'user') return 'user';
  if (/Aegos Landing IP|api6?\.ipify\.org|checkip\.amazonaws\.com|ident\.me|ifconfig\.me|icanhazip\.com/i.test(condition)) return 'system';
  return 'config';
}

function splitRoutingRules(rawRules = []) {
  const rules = Array.isArray(rawRules) ? rawRules : [];
  const explicitUserRules = rules.filter((item) => routingRuleCategory(item) === 'user');
  const configRules = rules.filter((item) => routingRuleCategory(item) === 'config');
  const systemRules = rules.filter((item) => routingRuleCategory(item) === 'system');
  return {
    userRules: explicitUserRules,
    configRules,
    systemRules
  };
}

function routingSystemRuleBuckets(rules = []) {
  const buckets = [
    ['ai', 'AI / ÷', /openai|chatgpt|anthropic|gemini|copilot|ai/i],
    ['media', 'ý', /netflix|disney|youtube|spotify|hulu|prime/i],
    ['telegram', 'Telegram / 通讯', /telegram|whatsapp|signal|discord/i],
    ['cn', '直连', /CN|china|geosite:cn|geoip:cn/i],
    ['ads', '', /ad|ads|reject|block/i],
    ['fallback', '兜底', /MATCH|FINAL/i]
  ];
  return buckets.map(([key, label, pattern]) => ({
    key,
    label,
    count: rules.filter((item) => pattern.test(`${item.kind || ''} ${item.condition || ''} ${item.target || ''}`)).length
  })).filter((item) => item.count > 0);
}

function routingTargetOptionsFull() {
  const groups = Array.isArray(latestRoutingSnapshot?.groups) ? latestRoutingSnapshot.groups : [];
  const targets = new Map([
    ['Proxies', 'Proxies'],
    ['DIRECT', '直连'],
    ['REJECT', '拒绝']
  ]);
  groups.forEach((group) => {
    const name = String(group.name || '').trim();
    if (name) targets.set(name, name);
    const items = Array.isArray(group.items) ? group.items : [];
    items.forEach((item) => {
      const itemName = String(item.name || '').trim();
      if (itemName && itemName !== 'GLOBAL' && itemName !== 'Aegos Landing IP') targets.set(itemName, itemName);
    });
  });
  return [...targets.entries()].map(([value, label]) => ({ value, label }));
}

function optionNodes(options = [], selected = []) {
  const selectedSet = new Set(Array.isArray(selected) ? selected : [selected]);
  return options.map((item) => {
    const option = el('option', { textContent: item.label, attrs: { value: item.value } });
    option.selected = selectedSet.has(item.value);
    return option;
  });
}

function routingRuleForm(rules = []) {
  const editing = rules.find((rule) => rule.raw === routingRuleEditRaw);
  const targetOptions = routingTargetOptionsFull();
  const kind = editing?.kind || 'DOMAIN-SUFFIX';
  return el('form', { id: 'routingRuleForm', className: 'routing-edit-form' }, [
    el('div', { className: 'routing-form-title' }, [
      el('b', { textContent: editing ? '编辑规则' : '添加规则' }),
      el('small', { textContent: '填写网站、应用或 IP，并选择要走的策略组。' })
    ]),
    el('input', { id: 'routingRuleOriginalRaw', attrs: { type: 'hidden', value: editing?.raw || '' } }),
    el('label', { className: 'routing-field' }, [
      el('span', { textContent: '' }),
      el('select', { id: 'routingRuleKindSelect' }, [
        el('option', { textContent: '域名后缀', attrs: { value: 'DOMAIN-SUFFIX' } }),
        el('option', { textContent: '', attrs: { value: 'DOMAIN' } }),
        el('option', { textContent: '域名关键字', attrs: { value: 'DOMAIN-KEYWORD' } }),
        el('option', { textContent: '应用名称', attrs: { value: 'PROCESS-NAME' } }),
        el('option', { textContent: '应用路径', attrs: { value: 'PROCESS-PATH' } }),
        el('option', { textContent: ' IP', attrs: { value: 'GEOIP' } }),
        el('option', { textContent: '网站集合', attrs: { value: 'GEOSITE' } }),
        el('option', { textContent: 'IP ', attrs: { value: 'IP-CIDR' } })
      ])
    ]),
    el('label', { className: 'routing-field' }, [
      el('span', { textContent: '' }),
      el('input', { id: 'routingRuleConditionInput', attrs: { value: editing?.condition || '', placeholder: 'example.com / Telegram.exe / CN', autocomplete: 'off' } })
    ]),
    el('label', { className: 'routing-field' }, [
      el('span', { textContent: '' }),
      el('select', { id: 'routingRuleTargetSelect' }, optionNodes(targetOptions, editing?.target || 'Proxies'))
    ]),
    el('label', { className: 'routing-field' }, [
      el('span', { textContent: '选项' }),
      el('select', { id: 'routingRuleOptionSelect' }, [
        el('option', { textContent: '', attrs: { value: '' } }),
        el('option', { textContent: 'no-resolve', attrs: { value: 'no-resolve' } })
      ])
    ]),
    el('div', { className: 'routing-edit-actions' }, [
      el('button', { className: 'primary compact', attrs: { type: 'submit' }, textContent: editing ? '保存' : '添加' }),
      el('button', { className: 'ghost compact', dataset: { cancelRoutingRuleEdit: '1' }, attrs: { type: 'button' }, textContent: '取消编辑' })
    ])
  ]);
}

function setSelectValue(id, value) {
  const target = $(`#${id}`);
  if (target) target.value = value || '';
}

function renderRoutingRuleWorkbench(rules = []) {
  const editing = rules.find((rule) => rule.raw === routingRuleEditRaw);
  const rows = rules.map((item) => el('div', { className: 'routing-work-row' }, [
    el('div', {}, [
      el('b', { textContent: `${routingKindLabel(item.kind)}  ${item.condition || '-'}` }),
      el('small', { textContent: ` ${routingTargetLabel(item.target)}  ${item.raw || '-'}` })
    ]),
    el('div', { className: 'routing-work-actions' }, [
      el('button', { className: 'ghost compact', dataset: { editRoutingRule: item.raw || '' }, textContent: '编辑' }),
      el('button', { className: 'ghost compact danger', dataset: { deleteRoutingRule: item.raw || '' }, textContent: 'ɾ' })
    ])
  ]));
  const body = [];
  if (editing) body.push(routingRuleForm(rules));
  body.push(el('div', { className: 'routing-work-list' }, rows.length ? rows : [emptyState('暂无用户规则')]));
  return body;
}

function renderRoutingSystemWorkbench(rules = []) {
  const buckets = routingSystemRuleBuckets(rules);
  const bucketRows = buckets.map((item) => el('div', { className: 'routing-work-row readonly' }, [
    el('div', {}, [
      el('b', { textContent: item.label }),
      el('small', { textContent: `${item.count}  ${item.detail || 'Aegos 自动维护的内部规则'}` })
    ]),
    el('span', { className: 'routing-readonly-pill', textContent: '只读' })
  ]));
  const sampleRows = rules.slice(0, 8).map((item) => el('div', { className: 'routing-work-row readonly compact' }, [
    el('div', {}, [
      el('b', { textContent: `${routingKindLabel(item.kind)}  ${item.condition || '-'}` }),
      el('small', { textContent: item.explanation || ' / Aegos 内部规则，避免误删。' })
    ]),
    el('span', { className: 'routing-readonly-pill', textContent: '只读' })
  ]));
  return [
    el('div', { className: 'routing-work-list routing-system-buckets' }, bucketRows.length ? bucketRows : [emptyState('暂无系统规则')]),
    el('details', { className: 'routing-inline-details' }, [
      el('summary', {}, [
        el('b', { textContent: '查看明细' }),
        el('small', { textContent: '这些规则只展示，不允许编辑。' })
      ]),
      el('div', { className: 'routing-work-list' }, sampleRows.length ? sampleRows : [emptyState('暂无明细')])
    ])
  ];
}

function renderRoutingGroupSummaryForRules(groups = []) {
  const rows = groups.slice(0, 12).map((item) => el('div', { className: 'routing-work-row readonly' }, [
    el('div', {}, [
      el('b', { textContent: item.name || '-' }),
      el('small', { textContent: `${routingStrategyTypeLabel(item.type)}  当前 ${item.now || '-'}  ${item.itemCount ?? 0} 个节点` })
    ]),
    el('button', { className: 'ghost compact', dataset: { pageJump: 'nodes' }, attrs: { type: 'button' }, textContent: '' })
  ]));
  return [
    el('div', { className: 'routing-group-guide' }, [
      el('div', {}, [
        el('b', { textContent: '策略组在节点页管理' }),
        el('small', { textContent: '节点选择、排序和编辑统一放在节点页，避免重复入口。' })
      ]),
      el('button', { className: 'primary compact', dataset: { pageJump: 'nodes' }, attrs: { type: 'button' }, textContent: '去节点页' })
    ]),
    el('div', { className: 'routing-explain-grid' }, [
      el('span', { textContent: ` -> ${groups.length} ` }),
      el('span', { textContent: '只读预览' }),
      el('span', { textContent: '节点组 / 编辑 / 排序' })
    ]),
    el('div', { className: 'routing-work-list' }, rows.length ? rows : [emptyState('暂无策略组')])
  ];
}

function renderRoutingSummaryDetail() {
  const box = $('#routingSummaryDetail');
  if (!box) return;
  const groups = Array.isArray(latestRoutingSnapshot?.groups) ? latestRoutingSnapshot.groups : [];
  const rawRules = Array.isArray(latestRoutingSnapshot?.rules) ? latestRoutingSnapshot.rules : [];
  const { userRules, configRules, systemRules } = splitRoutingRules(rawRules);
  const mode = modeLabel(latestRoutingSnapshot?.mode || latestStatus?.mode || 'rule');
  const summary = latestRoutingSnapshot?.summary || {};
  const viewMeta = {
    mode: {
      title: '\u5f53\u524d\u6a21\u5f0f',
      desc: `${mode}\uff1a\u6309\u89c4\u5219\u51b3\u5b9a\u76f4\u8fde\u3001\u4ee3\u7406\u6216\u62d2\u7edd\u3002\u9884\u89c8\u548c\u9a8c\u8bc1\u4e0d\u4f1a\u6539\u53d8\u5f53\u524d\u8fde\u63a5\u3002`,
      body: [el('div', { className: 'routing-explain-grid' }, [
        el('span', { textContent: `当前模式：${mode}` }),
        el('span', { textContent: 'û' }),
        el('span', { textContent: '网站 / 应用 > 策略组 > 节点' })
      ])]
    },
    groups: {
      title: '\u7b56\u7565\u7ec4',
      desc: '\u7b56\u7565\u7ec4\u662f\u8282\u70b9\u7684\u96c6\u5408\u6216\u81ea\u52a8\u9009\u62e9\u5668\u3002\u4e3a\u4e86\u907f\u514d\u91cd\u590d\u64cd\u4f5c\uff0c\u7f16\u8f91\u3001\u6392\u5e8f\u3001\u9009\u8282\u70b9\u653e\u5728\u8282\u70b9\u9875\u7edf\u4e00\u5904\u7406\u3002',
      body: renderRoutingGroupSummaryForRules(groups)
    },
    user: {
      title: '\u7528\u6237\u89c4\u5219',
      desc: '\u8fd9\u91cc\u53ea\u653e\u4f60\u901a\u8fc7 Aegos \u751f\u6210\u5e76\u5e94\u7528\u7684\u89c4\u5219\u3002\u7528\u6237\u89c4\u5219\u4f18\u5148\uff1a\u5177\u4f53\u7f51\u7ad9/\u5e94\u7528\u4f18\u5148\u4e8e\u573a\u666f\uff0c\u573a\u666f\u4f18\u5148\u4e8e\u8ba2\u9605\u515c\u5e95\u3002',
      body: renderRoutingRuleWorkbench(userRules)
    },
    system: {
      title: '\u7cfb\u7edf\u89c4\u5219',
      desc: `\u7cfb\u7edf\u89c4\u5219\u662f Aegos \u5185\u90e8\u8f85\u52a9\u89c4\u5219\uff0c\u4f8b\u5982\u843d\u5730 IP \u67e5\u8be2\u7528\u7684\u9690\u85cf\u89c4\u5219\u3002\u8ba2\u9605\u5e26\u6765\u7684\u666e\u901a\u89c4\u5219\u4f1a\u653e\u5728\u201c\u914d\u7f6e\u89c4\u5219\u660e\u7ec6\u201d\u4e2d\u67e5\u770b\u3002`,
      body: renderRoutingSystemWorkbench(systemRules)
    }
  };
  const view = viewMeta[routingSummaryDetail] || viewMeta.user;
  replaceChildrenSafe(box, [
    el('div', {}, [
      el('b', { textContent: view.title }),
      el('small', { textContent: view.desc }),
      routingSummaryDetail === 'system'
        ? el('small', { textContent: `还有 ${configRules.length} 条配置规则可在明细中查看` })
        : null
    ]),
    el('div', { className: 'routing-workbench' }, view.body || [])
  ].filter(Boolean));
  setSelectValue('routingRuleKindSelect', userRules.find((rule) => rule.raw === routingRuleEditRaw)?.kind || 'DOMAIN-SUFFIX');
  setSelectValue('routingRuleOptionSelect', (userRules.find((rule) => rule.raw === routingRuleEditRaw)?.options || [])[0] || '');
}

function setRoutingAssistantKind(kind = 'website') {
  routingAssistantKind = ['website', 'app', 'system'].includes(kind) ? kind : 'website';
  const assistant = document.querySelector('.routing-assistant');
  if (assistant) assistant.dataset.kind = routingAssistantKind;
  document.querySelectorAll('[data-routing-kind]').forEach((button) => {
    button.classList.toggle('active', button.dataset.routingKind === routingAssistantKind);
  });
  document.querySelectorAll('[data-routing-panel]').forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.routingPanel === routingAssistantKind);
  });
  const focusTarget = {
    website: '#routingWebsiteInput',
    app: '#routingAppInput',
    system: '#routingShowSystemRulesBtn'
  }[routingAssistantKind];
  runWhenIdle(() => $(focusTarget)?.focus?.());
}

function renderRoutingDraftList() {
  const list = $('#routingDraftList');
  const summary = $('#routingConflictSummary');
  if (!list || !summary) return;
  const rows = routingAssistantDrafts.map((item) => {
    const classification = classifyRoutingDraft(item);
    const sourceLabel = {
      website: '\u7f51\u7ad9',
      app: '\u5e94\u7528',
      region: '\u573a\u666f',
      connection: '\u8fde\u63a5\u8bb0\u5f55'
    }[item.source] || '\u8349\u7a3f';
    const priorityText = ['website', 'app', 'connection'].includes(item.source)
      ? '\u4f18\u5148\u7ea7\uff1a\u7528\u6237\u89c4\u5219\u4f18\u5148\uff0c\u5177\u4f53\u7f51\u7ad9/\u5e94\u7528\u9ad8\u4e8e\u573a\u666f\u89c4\u5219'
      : '\u4f18\u5148\u7ea7\uff1a\u573a\u666f\u89c4\u5219\u4f18\u5148\u4e8e\u8ba2\u9605\u515c\u5e95\uff0c\u4f46\u4f4e\u4e8e\u5177\u4f53\u7f51\u7ad9/\u5e94\u7528';
    const nextStep = classification.level === 'warn'
      ? '\u4e0b\u4e00\u6b65\uff1a\u5904\u7406\u98ce\u9669\u540e\u518d\u5e94\u7528'
      : item.verified
        ? '\u4e0b\u4e00\u6b65\uff1a\u53ef\u5e94\u7528'
        : '\u4e0b\u4e00\u6b65\uff1a\u5148\u9a8c\u8bc1';
    const detailOpen = expandedRoutingDraftId === item.id;
    const children = [
      el('div', { className: 'routing-draft-main' }, [
        el('div', {}, [
          el('b', { textContent: item.label || `${routingKindLabel(item.kind)} ${item.condition}` }),
          el('small', { textContent: `${sourceLabel} \u00b7 ${classification.text} \u00b7 ${nextStep}` })
        ]),
        el('span', { className: item.verified ? 'ok' : 'muted', textContent: item.verified ? '\u5df2\u9a8c\u8bc1' : '\u672a\u751f\u6548' }),
        el('button', { className: 'ghost compact', dataset: { toggleRoutingDraftDetail: item.id }, textContent: detailOpen ? '\u6536\u8d77' : '\u8be6\u60c5' }),
        el('button', { className: 'ghost compact', dataset: { verifyRoutingDraft: item.id }, textContent: '\u9a8c\u8bc1' }),
        el('button', { className: 'ghost compact', dataset: { removeRoutingDraft: item.id }, textContent: '\u64a4\u9500' })
      ])
    ];
    if (detailOpen) {
      children.push(el('div', { className: 'routing-draft-detail' }, [
        el('span', { textContent: `\u89c4\u5219\uff1a${item.rule}` }),
        el('span', { textContent: priorityText }),
        el('span', { textContent: `\u5f71\u54cd\uff1a\u53ea\u5f71\u54cd ${item.condition || item.label || '\u8be5\u6761\u4ef6'}\uff0c\u5e94\u7528\u524d\u4ecd\u53ef\u64a4\u9500\u8349\u7a3f\u3002` })
      ]));
    }
    return el('div', { className: `routing-draft-row ${classification.level === 'warn' ? 'warn' : ''} ${detailOpen ? 'open' : ''}` }, children);
  });
  replaceChildrenSafe(list, rows.length ? rows : [emptyState('\u6682\u65e0\u8349\u7a3f\u3002')]);
  const conflicts = routingAssistantDrafts.filter((item) => classifyRoutingDraft(item).level === 'warn').length;
  summary.textContent = routingAssistantDrafts.length
    ? `${routingAssistantDrafts.length} \u6761\u8349\u7a3f\uff0c${conflicts} \u6761\u9700\u8981\u6ce8\u610f\u3002`
    : '\u6682\u65e0\u8349\u7a3f\u3002';
  summary.className = `routing-draft-preview ${conflicts ? 'warn' : 'ok'}`;
}

function regionRoutingDraftPreset(value = '', target = 'Proxies') {
  const presets = {
    'cn-direct': { kind: 'GEOIP', condition: 'CN', target: 'DIRECT', option: 'no-resolve', label: '\u4e2d\u56fd\u5927\u9646 \u2192 \u76f4\u8fde' },
    'global-proxy': { kind: 'GEOSITE', condition: 'geolocation-!cn', target, label: `\u56fd\u5916\u7f51\u7ad9 \u2192 ${routingTargetLabel(target)}` },
    'telegram-proxy': { kind: 'GEOSITE', condition: 'telegram', target, label: `Telegram \u2192 ${routingTargetLabel(target)}` },
    'netflix-proxy': { kind: 'GEOSITE', condition: 'netflix', target, label: `Netflix \u2192 ${routingTargetLabel(target)}` }
  };
  return presets[value] || presets['global-proxy'];
}

function normalizeWebsiteRuleInput(value = '') {
  let input = String(value || '').trim();
  if (!input) return { ok: false, error: '\u8bf7\u5148\u8f93\u5165\u57df\u540d\u3002' };
  input = input.replace(/^https?:\/\//i, '').split('/')[0].split('?')[0].replace(/^\*\./, '').toLowerCase();
  const ok = /^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(input);
  if (!ok) return { ok: false, error: '\u57df\u540d\u683c\u5f0f\u4e0d\u5bf9\uff0c\u4f8b\u5982 example.com\u3002' };
  return { ok: true, domain: input };
}

function previewWebsiteRoutingDraft() {
  const preview = $('#routingDraftPreview');
  const input = $('#routingWebsiteInput');
  const action = $('#routingWebsiteAction')?.value || 'proxy';
  if (!preview || !input) return;
  const parsed = normalizeWebsiteRuleInput(input.value);
  if (!parsed.ok) {
    preview.textContent = parsed.error;
    preview.className = 'routing-draft-preview warn';
    return;
  }
  const target = action === 'proxy' ? $('#routingWebsiteTargetSelect')?.value || '' : '';
  const next = routingDraftAction(action, target);
  const draft = addRoutingDraft({
    kind: 'DOMAIN-SUFFIX',
    condition: parsed.domain,
    target: next.target,
    label: `${parsed.domain} \u2192 ${next.label}`,
    source: 'website'
  });
  preview.textContent = `\u8349\u7a3f\uff1a${draft.label}\u3002${draft.classification.text}`;
  preview.dataset.rule = draft.rule;
  preview.className = 'routing-draft-preview ok';
}

function normalizeAppRuleInput(value = '') {
  const raw = String(value || '').trim().replace(/^"|"$/g, '');
  if (!raw) return { ok: false, error: '\u8bf7\u5148\u8f93\u5165\u5e94\u7528\u8fdb\u7a0b\u540d\u3002' };
  if (/[\r\n<>|?*]/.test(raw) || raw.length > 180) return { ok: false, error: '\u5e94\u7528\u540d\u6216\u8def\u5f84\u683c\u5f0f\u4e0d\u5bf9\u3002' };
  const isPath = /^[a-z]:\\/i.test(raw) || raw.includes('\\') || raw.includes('/');
  if (isPath) {
    const normalizedPath = raw.replace(/\//g, '\\');
    const leaf = normalizedPath.split('\\').filter(Boolean).pop() || '';
    if (!/\.exe$/i.test(leaf)) return { ok: false, error: '\u8def\u5f84\u9700\u8981\u6307\u5411 .exe \u5e94\u7528\u3002' };
    return { ok: true, kind: 'PROCESS-PATH', value: normalizedPath };
  }
  const processName = /\.exe$/i.test(raw) ? raw : `${raw}.exe`;
  if (!/^[\w .()+#-]{2,80}\.exe$/i.test(processName)) return { ok: false, error: '\u8bf7\u8f93\u5165\u8fdb\u7a0b\u540d\uff0c\u4f8b\u5982 Telegram.exe\u3002' };
  return { ok: true, kind: 'PROCESS-NAME', value: processName };
}

function previewAppRoutingDraft() {
  const preview = $('#routingAppDraftPreview');
  const input = $('#routingAppInput');
  const action = $('#routingAppAction')?.value || 'proxy';
  if (!preview || !input) return;
  const parsed = normalizeAppRuleInput(input.value);
  if (!parsed.ok) {
    preview.textContent = parsed.error;
    preview.className = 'routing-draft-preview warn';
    return;
  }
  const target = action === 'proxy' ? $('#routingAppTargetSelect')?.value || '' : '';
  const next = routingDraftAction(action, target);
  const draft = addRoutingDraft({
    kind: parsed.kind,
    condition: parsed.value,
    target: next.target,
    label: `${parsed.value} \u2192 ${next.label}`,
    source: 'app'
  });
  preview.textContent = `\u8349\u7a3f\uff1a${draft.label}\u3002${draft.classification.text}`;
  preview.dataset.rule = draft.rule;
  preview.className = 'routing-draft-preview ok';
}

function previewRegionRoutingDraft() {
  const preview = $('#routingRegionDraftPreview');
  if (!preview) return;
  const value = $('#routingRegionSelect')?.value || 'global-proxy';
  const target = $('#routingTargetSelect')?.value || routingTargetOptions()[0]?.value || 'Proxies';
  const preset = regionRoutingDraftPreset(value, target);
  const draft = addRoutingDraft({
    ...preset,
    source: 'region'
  });
  preview.textContent = `\u8349\u7a3f\uff1a${draft.label}\u3002${draft.classification.text}`;
  preview.dataset.rule = draft.rule;
  preview.className = draft.classification.level === 'warn' ? 'routing-draft-preview warn' : 'routing-draft-preview ok';
}

function normalizeConnectionRoutingTarget(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return { ok: false, error: '\u8fde\u63a5\u76ee\u6807\u4e0d\u53ef\u7528\u3002' };
  const target = raw.replace(/^https?:\/\//i, '').split('/')[0].replace(/^\[|\]$/g, '');
  const host = target.includes(':') && !target.includes('::') ? target.split(':')[0] : target;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    const parts = host.split('.').map((item) => Number(item));
    if (parts.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
      return { ok: true, kind: 'IP-CIDR', value: `${host}/32`, display: host };
    }
  }
  const domain = normalizeWebsiteRuleInput(host);
  if (domain.ok) return { ok: true, kind: 'DOMAIN-SUFFIX', value: domain.domain, display: domain.domain };
  return { ok: false, error: '\u8fde\u63a5\u76ee\u6807\u6682\u65e0\u6cd5\u751f\u6210\u8349\u7a3f\u3002' };
}

function previewConnectionRoutingDraftFromButton(button) {
  const target = button?.dataset.routingDraftTarget || '';
  const preview = $('#routingDraftPreview');
  if (!preview) return;
  const parsed = normalizeConnectionRoutingTarget(target);
  if (!parsed.ok) {
    preview.textContent = parsed.error;
    preview.className = 'routing-draft-preview warn';
    return;
  }
  const next = routingDraftAction('proxy');
  const websiteInput = $('#routingWebsiteInput');
  if (websiteInput && parsed.kind === 'DOMAIN-SUFFIX') websiteInput.value = parsed.value;
  const draft = addRoutingDraft({
    kind: parsed.kind,
    condition: parsed.value,
    target: next.target,
    option: parsed.kind === 'IP-CIDR' ? 'no-resolve' : '',
    label: `${parsed.display} \u2192 ${next.label}`,
    source: 'connection'
  });
  preview.textContent = `\u8349\u7a3f\uff1a${draft.label}\u3002\u6765\u81ea\u8fde\u63a5\u8bb0\u5f55\uff0c${draft.classification.text}`;
  preview.dataset.rule = draft.rule;
  preview.className = 'routing-draft-preview ok';
}

function isAegosSystemRoutingRule(item = {}) {
  const target = String(item.target || '');
  const condition = String(item.condition || '');
  return target === 'Aegos Landing IP' || /(?:api6?\.ipify\.org|checkip\.amazonaws\.com|ident\.me|ifconfig\.me|icanhazip\.com)/i.test(condition);
}

function routingKindLabel(kind = '') {
  const value = String(kind || '').toUpperCase();
  if (value === 'DOMAIN' || value === 'DOMAIN-SUFFIX' || value === 'DOMAIN-KEYWORD') return '\u7f51\u7ad9';
  if (value === 'PROCESS-NAME' || value === 'PROCESS-PATH') return '\u5e94\u7528';
  if (value === 'GEOIP') return '\u5730\u533a';
  if (value.startsWith('IP-')) return 'IP';
  if (value === 'MATCH') return '\u9ed8\u8ba4';
  return value || '-';
}

function routingTargetLabel(target = '') {
  const value = String(target || '');
  if (value === 'DIRECT') return '\u76f4\u8fde';
  if (value === 'REJECT' || value === 'REJECT-DROP') return '\u62d2\u7edd';
  if (value === 'GLOBAL') return '\u5168\u5c40';
  return value || '-';
}

function routingStatusLabel(item = {}) {
  if (item.missingTarget) return '\u76ee\u6807\u7f3a\u5931';
  if (item.orderIssue) return '\u987a\u5e8f\u98ce\u9669';
  if (item.status === 'invalid') return '\u6709\u95ee\u9898';
  if (item.status === 'unsupported') return '\u6682\u4e0d\u652f\u6301';
  if (routingRuleCategory(item) === 'user') return '\u7528\u6237\u89c4\u5219';
  return '\u914d\u7f6e\u89c4\u5219';
}

function renderRoutingSnapshot(data = {}) {
  ensureRoutingAssistantUi();
  latestRoutingSnapshot = data || {};
  refreshRoutingTargetOptions();
  const groups = Array.isArray(data.groups) ? data.groups : [];
  const rawRules = Array.isArray(data.rules) ? data.rules : [];
  const { userRules: rules, configRules, systemRules } = splitRoutingRules(rawRules);
  const visibleRules = [...rules, ...configRules];
  const summary = data.summary || {};
  $('#routingModeState').textContent = modeLabel(data.mode || latestStatus?.mode || 'rule');
  $('#routingGroupCount').textContent = String(summary.groupCount ?? groups.length);
  $('#routingRuleHitCount').textContent = String(summary.userRuleCount ?? rules.length);
  $('#routingSystemRuleCount').textContent = String(systemRules.length);
  if (!routingApplyStatus && data.lastApply) {
    routingApplyStatus = {
      state: 'applied',
      profileName: data.lastApply.profileName || '',
      appliedCount: data.lastApply.appliedCount || 0,
      rollbackAvailable: Boolean(data.lastApply.rollbackAvailable),
      detail: '\u68c0\u6d4b\u5230\u6700\u8fd1\u4e00\u6b21 Aegos \u5e94\u7528\u7684\u5206\u6d41\u89c4\u5219\uff0c\u53ef\u5728\u672c\u9875\u64a4\u9500\u3002'
    };
  }
  const hint = $('#routingSystemRuleHint');
  if (hint) hint.textContent = systemRules.length
    ? `\u5df2\u6536\u8d77 ${systemRules.length} \u6761 Aegos \u5185\u7f6e\u68c0\u6d4b\u89c4\u5219\uff0c\u4e0d\u5f71\u54cd\u7528\u6237\u89c4\u5219\u3002`
    : '\u4e0b\u65b9\u5c55\u793a\u7528\u6237\u89c4\u5219\u548c\u8ba2\u9605\u914d\u7f6e\u89c4\u5219\u3002';
  const groupRows = groups.map((item) => el('div', { className: 'routing-row routing-group-row' }, [
    el('span', { textContent: item.name || '-', attrs: { title: item.name || '-' } }),
    el('span', { textContent: routingStrategyTypeLabel(item.type) }),
    el('span', { textContent: item.now || '-', attrs: { title: item.now || '-' } }),
    el('span', { textContent: String(item.itemCount ?? 0) }),
    el('span', { textContent: item.automatic ? '\u81ea\u52a8\u9009\u62e9\uff0c\u6d4b\u901f\u4e0d\u4f1a\u624b\u52a8\u5207\u6362' : '\u624b\u52a8\u9009\u62e9' })
  ]));
  replaceChildrenSafe($('#routingGroupRows'), groupRows.length ? groupRows : [emptyState('\u6682\u65e0\u7b56\u7565\u7ec4\u6570\u636e\u3002')]);
  const ruleRows = visibleRules.map((item) => {
    const options = Array.isArray(item.options) && item.options.length ? ` \u00b7 ${item.options.join(' / ')}` : '';
    const orderIssue = item.orderIssue?.detail ? ` \u00b7 ${item.orderIssue.detail}` : '';
    return el('div', { className: `routing-row routing-rule-row ${item.missingTarget || item.orderIssue ? 'warn' : ''}` }, [
      el('span', { textContent: `${item.index || '-'} ${routingKindLabel(item.kind)}`, attrs: { title: item.kind || '-' } }),
      el('span', { textContent: item.condition || '-', attrs: { title: item.condition || '-' } }),
      el('span', { textContent: routingTargetLabel(item.target), attrs: { title: `${item.target || '-'}${options}${orderIssue}` } }),
      el('span', { textContent: routingStatusLabel(item) })
    ]);
  });
  if (!ruleRows.length && data.ruleError) {
    ruleRows.push(el('div', { className: 'routing-row routing-rule-row warn' }, [
      el('span', { textContent: '-' }),
      el('span', { textContent: '-' }),
      el('span', { textContent: '-' }),
      el('span', { textContent: data.ruleError })
    ]));
  }
  replaceChildrenSafe($('#routingRuleRows'), ruleRows.length ? ruleRows : [emptyState('\u6682\u65e0\u914d\u7f6e\u89c4\u5219\u3002')]);
  setRoutingSummaryDetail(routingSummaryDetail);
  renderRoutingDraftList();
  renderRoutingApplyStatus();
}

async function submitRoutingRuleForm() {
  const raw = $('#routingRuleOriginalRaw')?.value || '';
  const kind = $('#routingRuleKindSelect')?.value || 'DOMAIN-SUFFIX';
  const condition = $('#routingRuleConditionInput')?.value || '';
  const target = $('#routingRuleTargetSelect')?.value || 'Proxies';
  const option = $('#routingRuleOptionSelect')?.value || '';
  const action = raw ? 'edit' : 'add';
  await runBackgroundJob('applyRoutingRuleEdit', {
    action,
    raw,
    kind,
    condition,
    target,
    option,
    label: `${condition} -> ${target}`
  }, { label: action === 'add' ? 'û' : 'û' });
  routingRuleEditRaw = '';
  await refreshRoutingSnapshot();
  setNotice(action === 'add' ? '规则已添加。' : '规则已保存。');
}

async function deleteRoutingRule(raw) {
  if (!raw) return;
  const confirmed = await requestAppConfirm({
    title: '删除规则',
    message: '删除这条用户规则？删除后会重新生成配置。',
    okText: '删除',
    danger: true
  });
  if (!confirmed) return;
  await runBackgroundJob('applyRoutingRuleEdit', { action: 'delete', raw }, { label: '删除规则' });
  if (routingRuleEditRaw === raw) routingRuleEditRaw = '';
  await refreshRoutingSnapshot();
  setNotice('规则已删除');
}

async function refreshRoutingSnapshot(token = null) {
  if (pageCacheState.routing.loading) return;
  pageCacheState.routing.loading = true;
  try {
    const data = await invoke('routing_snapshot');
    if (!isCurrentPageTask(token, 'routing')) return;
    renderRoutingSnapshot(data || {});
    markPageCache('routing');
  } catch (err) {
    if (!isCurrentPageTask(token, 'routing')) return;
    renderRoutingSnapshot({
      groups: [],
      rules: [],
      ruleError: `\u5206\u6d41\u6570\u636e\u6682\u65f6\u4e0d\u53ef\u7528\uff1a${err.message || err}`
    });
    replaceChildrenSafe($('#routingGroupRows'), [emptyState('\u5feb\u7167\u672a\u52a0\u8f7d\uff0c\u4f46\u4f60\u4ecd\u53ef\u4ee5\u5148\u521b\u5efa\u672a\u751f\u6548\u8349\u7a3f\u3002')]);
    markPageCache('routing');
  } finally {
    pageCacheState.routing.loading = false;
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
  if (check.ok) return '正常';
  if (check.severity === 'error') return '';
  return '';
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
  renderDiagnosticLogPreview();
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
      pendingNotice: '正在切换模式...',
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
    renderDiagnosticLogPreview();
    const errors = checks.filter((item) => item.severity === 'error').length;
    const warnings = checks.filter((item) => item.severity === 'warning').length;
    if (showNotice) setNotice(`诊断完成：正常 ${checks.filter((item) => item.ok).length}，错误 ${errors}，警告 ${warnings}`);
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
    if (showNotice) setNotice(`操作失败：${err.message || err}`);
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
$('#quickKillBtn')?.addEventListener('click', (event) => runButtonAction(event.currentTarget, '断网保护切换中...', () => updateSetting('killSwitchEnabled', !latestStatus?.settings?.killSwitchEnabled), { preserveContent: true }));
$('#quickTestBtn').onclick = (event) => testNodes(event.currentTarget);
$('#quickUpdateSubBtn').onclick = (event) => runButtonAction(event.currentTarget, '...', updateActiveProfile);
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
$('#quickRestartBtn').onclick = (event) => runButtonAction(event.currentTarget, '...', restartCoreJob);
$('#lockAutoGroupBtn')?.addEventListener('click', (event) => runButtonAction(event.currentTarget, '...', lockAutoGroupJob));
$('#refreshConnectionsBtn').onclick = refreshConnections;
$('#refreshRoutingBtn')?.addEventListener('click', (event) => runDetachedButtonAction(event.currentTarget, 'ˢ...', () => refreshRoutingSnapshot()));
$('#closeAllConnectionsBtn').onclick = (event) => runButtonAction(event.currentTarget, '关闭中...', () => runOptimisticAction({
  apply: () => { replaceChildrenSafe($('#connectionRows'), [emptyState('\u5f53\u524d\u6ca1\u6709\u6d3b\u52a8\u8fde\u63a5\u3002')]); },
  commit: () => invoke('close_connections'),
  refresh: () => refreshConnections(),
  rollback: () => refreshConnections(),
      pendingNotice: '正在切换模式...',
  successNotice: '已关闭连接',
    failureNotice: (err) => `诊断报告导出失败：${err.message || err}`
}));
$('#runDiagBtn').onclick = (event) => runDetachedButtonAction(event.currentTarget, '诊断中...', () => runDiagnostics());
const copyDiagBtn = $('#copyDiagBtn');
if (copyDiagBtn) copyDiagBtn.onclick = (event) => runButtonAction(event.currentTarget, '...', async () => {
  if (!latestDiagnostics) await runDiagnostics(false);
  const report = diagnosticReportText(latestDiagnostics);
  await navigator.clipboard?.writeText(report);
  setNotice('诊断报告已复制');
});
const exportLogsBtn = $('#exportLogsBtn');
if (exportLogsBtn) exportLogsBtn.onclick = (event) => runButtonAction(event.currentTarget, '...', exportLogs);
const exportDiagBtn = $('#exportDiagBtn');
if (exportDiagBtn) exportDiagBtn.onclick = (event) => runDetachedButtonAction(event.currentTarget, '...', exportDiagnosticReport);
const refreshEnvironmentBtn = $('#refreshEnvironmentBtn');
if (refreshEnvironmentBtn) refreshEnvironmentBtn.onclick = (event) => runDetachedButtonAction(event.currentTarget, '...', () => refreshEnvironmentReadiness(true));
$('#clearLogsBtn').onclick = () => runOptimisticAction({
  apply: () => applyOptimisticLogsClear(),
  commit: () => invoke('clear_logs'),
  refresh: () => refreshStatus(true),
      pendingNotice: '正在切换模式...',
  successNotice: '日志已清空',
    failureNotice: (err) => `诊断报告导出失败：${err.message || err}`
});
$('#restartCoreBtn').onclick = (event) => runButtonAction(event.currentTarget, '...', restartCoreJob);
const batchTestBtn = $('#batchTestBtn');
if (batchTestBtn) batchTestBtn.onclick = (event) => testNodes(event.currentTarget);
const nodeSearch = $('#nodeSearch');
if (nodeSearch) nodeSearch.oninput = () => {
  nodeSearchKeyword = nodeSearch.value.trim().toLowerCase();
  scheduleRowsRender(latestGroup?.items || [], { force: true, target: 'nodes' });
};
$('#savePortBtn').onclick = (event) => runButtonAction(event.currentTarget, '...', async () => {
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
    setNotice('端口设置已保存');
  } catch (err) {
    await refreshStatus(true);
    setNotice('端口设置已保存');
  }
});
const elevateBtn = $('#elevateBtn');
if (elevateBtn) elevateBtn.onclick = (event) => runButtonAction(event.currentTarget, '...', async () => {
  try {
    setNotice('正在请求管理员权限...');
    await invoke('relaunch_as_admin');
  } catch (err) {
    setNotice(`操作失败：${err.message || err}`);
  }
});
$('#addProfileBtn').onclick = (event) => runButtonAction(event.currentTarget, '...', async () => {
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
      await refreshProfileSurfaces({ refreshOutboundIp: true });
    },
    pendingNotice: '正在导入订阅...',
    successNotice: '已添加',
    failureNotice: (err) => `诊断报告导出失败：${err.message || err}`
  });
});
const copyEndpointBtn = $('#copyEndpointBtn');
if (copyEndpointBtn) copyEndpointBtn.onclick = () => navigator.clipboard?.writeText($('#nodeHost')?.textContent || '');
const updateAllProfilesBtn = $('#updateAllProfilesBtn');
if (updateAllProfilesBtn) updateAllProfilesBtn.onclick = (event) => runButtonAction(event.currentTarget, '...', async () => {
  await runOptimisticAction({
    apply: () => applyOptimisticProfilesPending('updating'),
    commit: async () => {
      const result = await updateAllProfilesJob();
      if (!result) throw new Error(lastBackgroundJobError || 'all subscription updates failed');
      return result;
    },
    refresh: async () => {
      await refreshProfileSurfaces({ refreshOutboundIp: true });
    },
    pendingNotice: '正在更新全部订阅...',
    successNotice: (result) => `全部订阅更新完成：成功 ${result?.updated?.length || 0}，失败 ${result?.failed?.length || 0}`,
    failureNotice: (err) => `诊断报告导出失败：${err.message || err}`
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
    setNotice(nextRegion ? `已筛选地区：${button.textContent.trim()}` : '已取消地区筛选');
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
  if (event.key === 'Escape' && !$('#appDialogOverlay')?.classList.contains('hidden')) {
    closeAppDialog(null);
    return;
  }
  if (event.key === 'Escape') closeNodeGroupContextMenu();
  if (event.key === 'Escape') closeNodeGroupMemberEditor();
  if (event.key === 'Escape') closeNodeGroupTargetEditor();
  if (event.key === 'Escape' && !$('#nodeEditorOverlay')?.classList.contains('hidden')) {
    closeNodeEditor();
  }
});

window.addEventListener('resize', positionQuickProfileMenu);
document.body.addEventListener('click', (event) => {
  const pageJumpButton = event.target.closest('[data-page-jump]');
  if (pageJumpButton) {
    event.preventDefault();
    setPage(pageJumpButton.dataset.pageJump || 'home');
    return;
  }
  const menuButton = event.target.closest('[data-node-group-menu-action]');
  if (menuButton) {
    event.preventDefault();
    void handleNodeGroupMenuAction(menuButton.dataset.nodeGroupMenuAction || '');
    return;
  }
  if (!event.target.closest('#nodeGroupContextMenu')) closeNodeGroupContextMenu();
});

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
  selectNode(row.dataset.node, row.dataset.backendGroup || '');
});

document.querySelector('.node-table')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-node-sort]');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  cycleNodeSort(button.dataset.nodeSort || '');
});

$('#homeNodeRows').addEventListener('click', (event) => {
  const row = event.target.closest('[data-node]');
  if (!row) return;
  selectNode(row.dataset.node, row.dataset.backendGroup || '');
});

$('#nodeRows').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = event.target.closest('.row[data-node]');
  if (!row) return;
  event.preventDefault();
  selectNode(row.dataset.node, row.dataset.backendGroup || '');
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
    const routingDraftButton = event.target.closest('[data-routing-draft-target]');
    if (routingDraftButton) {
      setPage('routing');
      ensureRoutingAssistantUi();
      previewConnectionRoutingDraftFromButton(routingDraftButton);
      setNotice('\u5df2\u4ece\u8fde\u63a5\u8bb0\u5f55\u751f\u6210\u5206\u6d41\u8349\u7a3f\uff0c\u672a\u4fee\u6539\u914d\u7f6e\u3002');
      return;
    }
    const verifyRoutingDraftButton = event.target.closest('[data-verify-routing-draft]');
    if (verifyRoutingDraftButton) {
      verifyRoutingDraft(verifyRoutingDraftButton.dataset.verifyRoutingDraft);
      return;
    }
    const detailRoutingDraftButton = event.target.closest('[data-toggle-routing-draft-detail]');
    if (detailRoutingDraftButton) {
      const id = detailRoutingDraftButton.dataset.toggleRoutingDraftDetail;
      expandedRoutingDraftId = expandedRoutingDraftId === id ? '' : id;
      renderRoutingDraftList();
      return;
    }
    const removeRoutingDraftButton = event.target.closest('[data-remove-routing-draft]');
    if (removeRoutingDraftButton) {
      removeRoutingDraft(removeRoutingDraftButton.dataset.removeRoutingDraft);
      return;
    }
    const editRoutingRuleButton = event.target.closest('[data-edit-routing-rule]');
    if (editRoutingRuleButton) {
      routingRuleEditRaw = editRoutingRuleButton.dataset.editRoutingRule || '';
      setRoutingSummaryDetail('user');
      return;
    }
    const deleteRoutingRuleButton = event.target.closest('[data-delete-routing-rule]');
    if (deleteRoutingRuleButton) {
      await deleteRoutingRule(deleteRoutingRuleButton.dataset.deleteRoutingRule || '');
      return;
    }
    const cancelRoutingRuleButton = event.target.closest('[data-cancel-routing-rule-edit]');
    if (cancelRoutingRuleButton) {
      routingRuleEditRaw = '';
      setRoutingSummaryDetail('user');
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
      pendingNotice: '正在切换模式...',
        successNotice: '已关闭连接',
    failureNotice: (err) => `诊断报告导出失败：${err.message || err}`
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
          await refreshProfileSurfaces({ refreshOutboundIp: true });
        },
        pendingNotice: '正在切换模式...',
        successNotice: '订阅已切换',
    failureNotice: (err) => `诊断报告导出失败：${err.message || err}`
      });
      return;
    }
    const profileRename = event.target.closest('[data-profile-rename]')?.dataset.profileRename;
    if (profileRename) {
      const profile = (latestStatus?.settings?.profiles || []).find((item) => item.id === profileRename);
      const nextName = await requestAppInput({
        title: '',
        message: '重命名 Aegos 策略组',
        label: '',
        value: profile?.name || '',
        hint: '只改显示名称，不改变节点',
        okText: ''
      });
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
          await refreshProfileSurfaces({ refreshOutboundIp: true });
        },
        pendingNotice: '正在更新...',
        successNotice: '已完成',
    failureNotice: (err) => `诊断报告导出失败：${err.message || err}`
      });
      return;
    }
    const profileRemove = event.target.closest('[data-profile-remove]')?.dataset.profileRemove;
    if (profileRemove) {
      await runOptimisticAction({
        apply: () => applyOptimisticProfileRemove(profileRemove),
        commit: () => removeProfileJob(profileRemove),
        refresh: async () => {
          await refreshProfileSurfaces({ refreshOutboundIp: true });
        },
      pendingNotice: '正在切换模式...',
        successNotice: '已删除',
        failureNotice: (err) => `删除失败：${err.message || err}`
      });
    }
  } catch (err) {
    setNotice(`操作失败：${err.message || err}`);
  }
});

document.body.addEventListener('submit', async (event) => {
  const ruleForm = event.target.closest('#routingRuleForm');
  if (ruleForm) {
    event.preventDefault();
    await submitRoutingRuleForm(ruleForm);
  }
});

normalizeShellStaticText();
ensureNodeGroupSwitcher();
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
