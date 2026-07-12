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

const renderStatusBody = bodyBetween(appJs, 'function renderStatus', 'function applyOptimisticMode');
const outboundBody = bodyBetween(appJs, 'async function refreshOutboundIpAfterNodeChange', 'async function captureNodeDiagnostics');

check('version is at least 3.4.15 home product checkpoint', /^3\.4\.(1[5-9]|20)$/.test(pkg.version), pkg.version);

check(
  'home first screen shows usable connection state',
  indexHtml.includes('id="connectBtn"') &&
    indexHtml.includes('id="nodeName"') &&
    indexHtml.includes('id="delayMetric"') &&
    indexHtml.includes('id="stabilityMetric"') &&
    indexHtml.includes('id="systemProxyMetric"') &&
    indexHtml.includes('id="outboundMetric"') &&
    indexHtml.includes('id="lanIpState"') &&
    renderStatusBody.includes('systemProxyMetric') &&
    renderStatusBody.includes("classList.toggle('is-danger'"),
  'connection, current node, latency, stability, system proxy, outbound IP, and LAN IP are visible'
);

check(
  'outbound IP has clear pending, success, stale, and failure states',
  appJs.includes('let outboundIpRequestSeq') &&
    appJs.includes('let outboundIpPendingSeq') &&
    appJs.includes('function setOutboundIpText(value, title =') &&
    outboundBody.includes("setOutboundIpText('\\u67e5\\u8be2\\u4e2d')") &&
    outboundBody.includes('setOutboundIpText(ip)') &&
    outboundBody.includes("outboundIpLastStable = '-'") &&
    outboundBody.includes("setOutboundIpText('\\u67e5\\u8be2\\u5931\\u8d25'") &&
    outboundBody.includes('seq !== outboundIpRequestSeq'),
  'old or failed outbound IP lookups must not look like a valid current IP'
);

check(
  'home quick actions are high-frequency and stable',
  ['quickTestBtn', 'quickProxyBtn', 'quickUpdateSubBtn', 'quickKillBtn', 'quickProfileBtn', 'quickRestartBtn'].every((id) => indexHtml.includes(`id="${id}"`)) &&
    !indexHtml.includes('id="quickIpBtn"') &&
    !indexHtml.includes('id="quickTunBtn"') &&
    !indexHtml.includes('id="quickCopyProxyBtn"') &&
    stylesCss.includes('--home-quick-row: 72px') &&
    stylesCss.includes('grid-template-rows: 36px') &&
    interactionSmoke.includes('removed quick actions still render'),
  'quick action row should not jump or expose low-value buttons'
);

check(
  'common region is the default home node view',
  appJs.includes("let homeRegionFilter = 'HK'") &&
    appJs.includes("let homeNodeMode = 'region'") &&
    indexHtml.includes('data-home-mode="region"') &&
    indexHtml.includes('data-region="HK"') &&
    appJs.includes("homeRegionFilter: mode === 'region'") &&
    appJs.includes("|| 'HK'") &&
    interactionSmoke.includes('home did not default to Hong Kong region'),
  'ordinary users land on common Hong Kong region nodes by default'
);

check(
  'home node list stays bounded and synchronized',
  appJs.includes('const homeNodeRenderLimit = 8') &&
    appJs.includes('function renderHomeNodeRow') &&
    appJs.includes('function summaryRowsFromLatestGroup') &&
    appJs.includes('renderHomeNodeSummary(summaryRowsFromLatestGroup())') &&
    appJs.includes("scheduleRowsRender(latestGroup.items, { force: true, target: 'all', delay: 0 })") &&
    interactionSmoke.includes('home node row order changed after selection') &&
    interactionSmoke.includes('home page did not receive node batch speed results'),
  'home list is small, stable, and receives shared speed updates'
);

check(
  'current-node metrics are truthful rather than fake load/loss columns',
  indexHtml.includes('<small>稳定性</small>') &&
    indexHtml.includes('<small>活跃连接</small>') &&
    indexHtml.includes('<small>上次测速</small>') &&
    !indexHtml.includes('<span>丢包率</span>') &&
    !indexHtml.includes('<span>负载</span>') &&
    appJs.includes('function stabilityInfo') &&
    appJs.includes('function lastTestedText') &&
    appJs.includes('active_connection_count'),
  'stability is current-node relative metadata; active connections and last test time are real runtime indicators'
);

check(
  'release gate already guards the home rules',
  releaseAudit.includes('home node mode filters are present') &&
    releaseAudit.includes('home low-value recommendation metrics are replaced with truthful runtime metrics') &&
    releaseAudit.includes('home latency refresh and stability visuals stay compact') &&
    releaseAudit.includes('fake node metrics are removed from node surfaces'),
  'global release audit keeps home product rules visible'
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
