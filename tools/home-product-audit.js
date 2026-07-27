import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appJs = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const releaseAudit = fs.readFileSync(path.join(root, 'tools', 'release-audit.js'), 'utf8');
const interactionSmoke = fs.readFileSync(path.join(root, 'tools', 'interaction-smoke.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const pass = [];
const fail = [];

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, detail });
}

function bodyBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return start >= 0 && end > start ? source.slice(start, end) : '';
}

function versionAtLeast(version, minimum) {
  const parse = (value) => String(value).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const current = parse(version);
  const target = parse(minimum);
  for (let index = 0; index < Math.max(current.length, target.length); index += 1) {
    if ((current[index] || 0) !== (target[index] || 0)) {
      return (current[index] || 0) > (target[index] || 0);
    }
  }
  return true;
}

const renderStatusBody = bodyBetween(appJs, 'function renderStatus', 'function applyOptimisticMode');
const outboundBody = bodyBetween(appJs, 'async function refreshOutboundIpAfterNodeChange', 'async function refreshOutboundIp()');
const refreshStatusBody = bodyBetween(appJs, 'async function refreshStatus', 'function renderActiveConnectionMetric');

check('version includes the 3.4.15 home product checkpoint', versionAtLeast(pkg.version, '3.4.15'), pkg.version);

check(
  'home first screen shows usable connection state',
  indexHtml.includes('id="connectBtn"') &&
    indexHtml.includes('id="nodeName"') &&
    indexHtml.includes('id="delayMetric"') &&
    indexHtml.includes('id="stabilityMetric"') &&
    indexHtml.includes('id="protocolMetric"') &&
    indexHtml.includes('id="outboundMetric"') &&
    indexHtml.includes('id="lanIpState"') &&
    !indexHtml.includes('id="systemProxyMetric"') &&
    !indexHtml.includes('id="networkAvailabilityMetric"'),
  'connection, current node, latency, stability, protocol, outbound IP, and LAN IP are visible without duplicate status metrics'
);

check(
  'outbound IP has clear pending, success, stale, and failure states',
  appJs.includes('let outboundIpRequestSeq') &&
    appJs.includes('let outboundIpPendingSeq') &&
    appJs.includes('function setOutboundIpText(value, title =') &&
    outboundBody.includes("setOutboundIpText('\\u67e5\\u8be2\\u4e2d')") &&
    outboundBody.includes('outboundIpPendingSeq = seq') &&
    outboundBody.includes('outboundIpPendingSeq = 0') &&
    outboundBody.includes('renderOutboundIpFromStatus(ip') &&
    outboundBody.includes("state: 'failed'") &&
    appJs.includes("const queryFailed = availability.state === 'failed'") &&
    appJs.includes('if (queryFailed && !historical)') &&
    appJs.includes("text: '\\u67e5\\u8be2\\u5931\\u8d25'") &&
    outboundBody.includes('lastBackgroundJobError') &&
    outboundBody.includes('seq !== outboundIpRequestSeq'),
  'old or failed outbound IP lookups must not look like a valid current IP'
);

check(
  'home quick actions are user-selected from a fixed catalog',
  ['quickTestBtn', 'quickUpdateSubBtn', 'quickKillBtn', 'quickProfileBtn', 'quickDiagnosticsBtn', 'quickRecoverBtn', 'quickCurrentTestBtn', 'quickRefreshNodesBtn', 'quickUpdateAllBtn', 'quickNodesPageBtn', 'quickConnectionsPageBtn', 'quickRoutingPageBtn', 'quickProfilesPageBtn'].every((id) => indexHtml.includes(`id="${id}"`)) &&
    !indexHtml.includes('id="quickProxyBtn"') &&
    !indexHtml.includes('id="quickRestartBtn"') &&
    !indexHtml.includes('id="quickIpBtn"') &&
    !indexHtml.includes('id="quickTunBtn"') &&
    !indexHtml.includes('id="quickCopyProxyBtn"') &&
    indexHtml.includes('class="quick node-quick-actions"') &&
    !indexHtml.includes('<section class="quick panel">') &&
    stylesCss.includes('--home-hero-row: 190px') &&
    stylesCss.includes('.node-quick-actions.quick') &&
    appJs.includes("const quickActionStorageKey = 'aegos.quickActions'") &&
    appJs.includes('const maxVisibleQuickActions = 4') &&
    appJs.includes('const quickActionCatalog') &&
    appJs.includes('function sanitizeQuickActions') &&
    appJs.includes('function applyQuickActionPreferences') &&
    appJs.includes('function openQuickActionContextMenu') &&
    !appJs.includes("action === 'quick-rename'") &&
    interactionSmoke.includes('resident quick action selection did not render or persist') &&
    interactionSmoke.includes('resident quick action replacement at the four-button limit failed') &&
    interactionSmoke.includes('resident quick action picker is oversized or has too few choices') &&
    interactionSmoke.includes('selected diagnostics quick action lost its original function') &&
    interactionSmoke.includes('quick actions did not move below the current node') &&
    interactionSmoke.includes('removed quick actions still render'),
  'one to four fixed-identity commands sit below the current node and persist selection/order'
);

check(
  'current-node identity never substitutes profile identity or a fixed region',
  indexHtml.includes('id="nodeRegionBadge" class="flag" title="等待节点数据">--</span>') &&
    appJs.includes('function renderCurrentNodeIdentity') &&
    appJs.includes('const region = current ? inferRegion(current)') &&
    appJs.includes("renderCurrentNodeIdentity(selected)") &&
    !renderStatusBody.includes('activeProfile.name ||') &&
    !indexHtml.includes('<span class="flag">HK</span>'),
  'node name and region badge are derived together from the selected runtime node'
);

check(
  'transient status read failures preserve the last truthful snapshot',
  refreshStatusBody.includes('\\u5f53\\u524d\\u663e\\u793a\\u4e0a\\u6b21\\u6570\\u636e') &&
    refreshStatusBody.includes('\\u72b6\\u6001\\u6682\\u65f6\\u65e0\\u6cd5\\u8bfb\\u53d6') &&
    !refreshStatusBody.includes('running: false') &&
    !refreshStatusBody.includes("activeProfile: { name: 'Aegos 预设'"),
  'failed app_status reads warn without fabricating a disconnected runtime or empty subscription'
);

check(
  'empty-state commands track real data availability',
  appJs.includes('function syncActionAvailability') &&
    appJs.includes('closeAllConnectionsBtn: activeConnectionCount > 0') &&
    appJs.includes('updateAllProfilesBtn: hasProfilesToUpdate') &&
    appJs.includes('copyDiagBtn: Boolean(latestDiagnostics)') &&
    appJs.includes('exportDiagBtn: Boolean(latestDiagnostics)') &&
    appJs.includes('quickTestBtn: hasNodes') &&
    !appJs.includes('if (!latestDiagnostics) await runDiagnostics(false)'),
  'connection, subscription, diagnostic, and speed commands disable when they have no valid target'
);

check(
  'home customization menus expose keyboard and assistive semantics',
  appJs.includes("role: 'menu'") &&
    appJs.includes("role: options.pressed == null ? 'menuitem' : 'menuitemcheckbox'") &&
    appJs.includes("'aria-haspopup': 'menu'") &&
    appJs.includes("event.key === 'ContextMenu'") &&
    appJs.includes("event.shiftKey && event.key === 'F10'") &&
    appJs.includes("closeHomeCustomizeContextMenu({ restoreFocus: true })") &&
    indexHtml.includes('role="status" aria-live="polite" aria-atomic="true"'),
  'right-click customization remains operable by keyboard and status updates are announced politely'
);

check(
  'common region is the default home node view',
  appJs.includes("Object.freeze({ code: 'HK'") &&
    appJs.includes("Object.freeze({ code: 'TW'") &&
    appJs.includes("Object.freeze({ code: 'US'") &&
    appJs.includes("Object.freeze({ code: 'JP'") &&
    appJs.includes("Object.freeze({ code: 'SG'") &&
    appJs.includes("const homeRegionStorageKey = 'aegos.homeRegions'") &&
    appJs.includes('function sanitizeHomeRegions') &&
    appJs.includes('function renderHomeRegions') &&
    appJs.includes('function openHomeRegionContextMenu') &&
    appJs.includes("let homeNodeMode = 'region'") &&
    indexHtml.includes('data-home-mode="region"') &&
    indexHtml.includes('id="fixedNodeActions" class="home-filter-actions hidden"') &&
    appJs.includes("$('#fixedNodeActions')?.classList.toggle('hidden', homeNodeMode !== 'fixed')") &&
    interactionSmoke.includes('fixed-node add action leaked into the common-region page') &&
    interactionSmoke.includes('fixed-node add action did not enter the fixed-node page') &&
    !indexHtml.includes('data-region="GB"') &&
    stylesCss.includes('repeat(var(--home-region-count, 5), minmax(108px, 1fr))') &&
    appJs.includes("homeRegionFilter: mode === 'region'") &&
    interactionSmoke.includes('home region add did not render and persist') &&
    interactionSmoke.includes('home region edit did not render and persist') &&
    interactionSmoke.includes('home region delete did not render and persist') &&
    interactionSmoke.includes('home region defaults did not restore') &&
    interactionSmoke.includes('home did not default to Hong Kong region'),
  'ordinary users land on common Hong Kong region nodes by default'
);

check(
  'home node list stays bounded and synchronized',
  appJs.includes('const homeNodeRenderLimit = 8') &&
    appJs.includes('function renderHomeNodeRow') &&
    appJs.includes('function summaryRowsFromLatestGroup') &&
    appJs.includes('rememberRankedRow(homeRows, row, compareHomeRows, homeNodeRenderLimit)') &&
    appJs.includes('.slice(0, homeNodeRenderLimit)') &&
    appJs.includes('renderHomeNodeSummary(summaryRows)') &&
    interactionSmoke.includes('home node row order changed after selection') &&
    interactionSmoke.includes('home page did not receive node batch speed results'),
  'home list is small, stable, and receives shared speed updates'
);

check(
  'current-node metrics are truthful rather than fake load/loss columns',
  indexHtml.includes('class="node-status-card metric-grid"') &&
    (indexHtml.match(/<article><span class="metric-icon/g) || []).length === 9 &&
    indexHtml.includes('<small>最近稳定性</small>') &&
    indexHtml.includes('<small>活跃连接</small>') &&
    indexHtml.includes('<small>上次测速</small>') &&
    !indexHtml.includes('<span>丢包率</span>') &&
    !indexHtml.includes('<span>负载</span>') &&
    appJs.includes('function stabilityInfo') &&
    appJs.includes('function lastTestedText') &&
    appJs.includes('active_connection_count'),
  'the sidebar node card keeps real stability, connection, test-age, endpoint, and traffic readings'
);

check(
  'release gate already guards the home rules',
  releaseAudit.includes('home node mode filters are present') &&
    releaseAudit.includes('truthful runtime metrics live in the compact sidebar node card') &&
    releaseAudit.includes('home latency action and stability visuals stay compact') &&
    releaseAudit.includes('node surfaces keep only decision-critical list columns'),
  'global release audit keeps home product rules visible'
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
