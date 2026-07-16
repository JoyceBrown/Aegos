import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
const coreRuntime = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'core_runtime.rs'), 'utf8');
const speedRuntime = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'speed_runtime.rs'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const speedAudit = fs.readFileSync(path.join(root, 'tools', 'speed-closure-audit.js'), 'utf8');
const interactionSmoke = fs.readFileSync(path.join(root, 'tools', 'interaction-smoke.js'), 'utf8');

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

const batchBackend = bodyBetween(mainRs, 'fn start_proxy_delay_test_for_run', 'fn test_single_proxy_delay_for_run');
const singleBackend = bodyBetween(mainRs, 'fn test_single_proxy_delay_for_run', 'fn probe_proxy_network');
const batchFrontend = bodyBetween(appJs, 'async function testNodes', 'async function refreshOutboundIpJob');
const singleFrontend = bodyBetween(appJs, 'async function waitForSingleNodeDelay', 'function openNodeEditor');
const applySpeed = bodyBetween(appJs, 'function applySpeedStatusToNodes', 'function normalizeNodeItem');
const profileSwitch = bodyBetween(appJs, 'function resetSpeedUiForProfileSwitch', 'async function pollSpeedTest');
const versionParts = pkg.version.split('.').map((part) => Number(part || 0));
const versionAtLeast3413 = versionParts[0] > 3 || (versionParts[0] === 3 && (versionParts[1] > 4 || (versionParts[1] === 4 && versionParts[2] >= 13)));

check('version is at least 3.4.13 speed product checkpoint', versionAtLeast3413, pkg.version);

check(
  'speed-test snapshot has a result signature',
  speedRuntime.includes('pub fn speed_result_signature') &&
    speedRuntime.includes('"resultSignature": speed_result_signature(&speed)') &&
    appJs.includes('status.resultSignature ||') &&
    applySpeed.includes('status.runId || 0'),
  'prevents equal-count stale UI refresh misses'
);

check(
  'batch speed test remains measurement-only',
  batchBackend.includes('speed.delays.insert') &&
    batchBackend.includes('speed.recommended = speed_recommendation') &&
    !batchBackend.includes('self.change_proxy') &&
    !batchBackend.includes('select_best_proxy') &&
    batchFrontend.includes("invoke('start_proxy_delay_test'") &&
    !batchFrontend.includes("runBackgroundJob('changeProxy'") &&
    !batchFrontend.includes("runBackgroundJob('selectBestProxy'"),
  'batch test must not connect, switch mode, or take over traffic'
);

check(
  'single node speed test remains local and non-blocking',
  singleBackend.includes('thread::spawn(move ||') &&
    singleBackend.includes('test_proxy_delay_with_retry') &&
    singleBackend.includes('speed.delays.insert(target.name.clone(), result.delay)') &&
    singleFrontend.includes('runLocalButtonAction') &&
    singleFrontend.includes('applyOptimisticNodeDelay(name, 0)') &&
    singleFrontend.includes('applyOptimisticNodeDelay(name, -1, timeoutResult.reason)') &&
    !singleFrontend.includes('await runButtonAction'),
  'single-node test only marks the row button busy'
);

check(
  'failure reasons are structured and visible',
  ['timeout', 'dns', 'tls', 'auth', 'unsupported-protocol', 'blocked', 'unreachable', 'controller-unavailable', 'node-not-found'].every((key) => `${mainRs}\n${coreRuntime}`.includes(key)) &&
    appJs.includes("return '被阻断'") &&
    appJs.includes("return '不可达'") &&
    appJs.includes('function speedFailureReasonLabel') &&
    appJs.includes('function nodeSpeedNoteInfo') &&
    appJs.includes("className: 'node-note note-bad'") &&
    indexHtml.includes('<span>状态</span>'),
  'tested failures must not collapse back to untested'
);

check(
  'home and node pages share one speed state source',
  appJs.includes('let latestSpeedStatus') &&
    appJs.includes('const changed = applySpeedStatusToNodes(status)') &&
    appJs.includes('updateVisibleNodeDelays(visibleChanges)') &&
    appJs.includes('refreshVisibleNodesForSpeed(!status.running, changed)') &&
    appJs.includes('pendingRowItems || latestGroup.items') &&
    appJs.includes('renderHomeNodeSummary(summaryRowsFromLatestGroup())') &&
    interactionSmoke.includes('node page did not receive quick home speed results') &&
    interactionSmoke.includes('home page did not receive node batch speed results'),
  'quick home speed and node-page batch speed must update both surfaces'
);

check(
  'profile switch cancels stale speed work',
  mainRs.includes('reset_speed_test_state("profile switched; previous speed test cancelled", true)') &&
    profileSwitch.includes('stopSpeedTestPolling()') &&
    profileSwitch.includes('latestSpeedStatus = null') &&
    appJs.includes('status.runId !== activeSpeedRunId'),
  'old subscription speed results cannot pollute new subscription'
);

check(
  'unsafe and pseudo speed targets are excluded',
  mainRs.includes('fn is_subscription_metadata_node_name') &&
    mainRs.includes('fn is_proxy_group_reference_item') &&
    mainRs.includes('matches!(name, "DIRECT" | "REJECT" | "PASS" | "COMPATIBLE")') &&
    mainRs.includes('fn speed_test_preflight') &&
    speedAudit.includes('speed-test targets exclude airport metadata and fake-ip nodes') &&
    speedAudit.includes('speed-test targets exclude proxy-group references'),
  'DIRECT, strategy groups, airport metadata, and fake-ip rows are not ordinary test targets'
);

check(
  'speed work does not disable global UI',
  appJs.includes('speedTestStarting') &&
    appJs.includes('speedTestButtons') &&
    appJs.includes("setButtonBusy(button, true, '\\u6d4b\\u901f\\u4e2d...', { preserveContent: true })") &&
    !batchFrontend.includes('foregroundBusy') &&
    !appJs.includes('button.disabled = busy') &&
    interactionSmoke.includes('speed test blocked sidebar page switching'),
  'navigation and unrelated buttons remain usable during speed tests'
);

check(
  'advanced protocol scheduling is explicit',
  mainRs.includes('protocol_concurrency("tuic")') &&
    mainRs.includes('protocol_concurrency("hysteria2")') &&
    mainRs.includes('protocol_family("anytls")') &&
    mainRs.includes('DelayProbeDepth::Fast') &&
    mainRs.includes('DelayProbeDepth::Full') &&
    mainRs.includes('FLCLASH_STYLE_TEST_URL') &&
    mainRs.includes('https://www.gstatic.com/generate_204'),
  'SS/Trojan/VLESS/TUIC/AnyTLS/Hysteria2 share explicit probe strategy'
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
