import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function bodyBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  if (start < 0) return '';
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return source.slice(start, end < 0 ? source.length : end);
}

const pkg = JSON.parse(read('package.json'));
const appJs = read('src/app.js');
const mainRs = read('src-tauri/src/main.rs');
const interactionSmoke = read('tools/interaction-smoke.js');
const perfSmoke = read('tools/perf-smoke.js');
const releaseAudit = read('tools/release-audit.js');
const backendAudit = read('tools/backend-audit.js');
const speedAudit = read('tools/speed-closure-audit.js');
const diagnosticsAudit = read('tools/diagnostics-logs-audit.js');
const responsivenessAudit = read('tools/responsiveness-audit.js');

const startSpeedCommand = bodyBetween(mainRs, '#[tauri::command]\nfn start_proxy_delay_test', '#[tauri::command]\nfn test_single_proxy_delay');
const singleSpeedCommand = bodyBetween(mainRs, '#[tauri::command]\nfn test_single_proxy_delay', '#[tauri::command]\nfn node_diagnostics');
const cancelSpeedCommand = bodyBetween(mainRs, 'fn cancel_proxy_delay_test', 'fn recover_network');
const speedStatusCommand = bodyBetween(mainRs, 'fn speed_test_status', 'fn cancel_proxy_delay_test');
const diagnosticsPageLoad = bodyBetween(appJs, 'function schedulePageLoad', 'let rowRenderFrame');
const testNodesBody = bodyBetween(appJs, 'async function testNodes', 'async function refreshOutboundIpJob');
const testSingleNodeBody = bodyBetween(appJs, 'async function testSingleNode', 'async function testCurrentNode');
const runDiagnosticsBody = bodyBetween(appJs, 'async function runDiagnostics', 'async function wireWindowControls');
const setButtonBusyBody = bodyBetween(appJs, 'function setButtonBusy', 'async function runButtonAction');
const resetSpeedUiBody = bodyBetween(appJs, 'function resetSpeedUiForProfileSwitch', 'async function pollSpeedTest');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
}

check(
  'stability audit is exposed as a package script',
  pkg.scripts?.['audit:stability'] === 'node tools/stability-regression-audit.js',
  'npm run audit:stability'
);

check(
  'legacy synchronous delay command is absent everywhere except documentation/audit guardrails',
  !mainRs.includes('fn test_proxy_delays') &&
    !appJs.includes('test_proxy_delays') &&
    !interactionSmoke.includes('test_proxy_delays'),
  'old lock-heavy speed path must not re-enter runtime or smoke mocks'
);

check(
  'batch speed command returns a snapshot and moves core work into a worker',
    startSpeedCommand.includes('mark_speed_test_preparing(&state.speed_test)') &&
    startSpeedCommand.includes('thread::spawn(move ||') &&
    startSpeedCommand.includes('start_proxy_delay_test_for_run(Some(run_id))') &&
    startSpeedCommand.includes('Ok(snapshot)') &&
    !startSpeedCommand.includes('state.core.lock().unwrap().start_proxy_delay_test'),
  'clicking one-key speed test must not wait for core preparation or proxy-group assembly'
);

check(
  'single-node speed command is also queued without blocking the clicked row',
  singleSpeedCommand.includes('mark_single_speed_test_preparing(&state.speed_test, &name)') &&
    singleSpeedCommand.includes('thread::spawn(move ||') &&
    singleSpeedCommand.includes('test_single_proxy_delay_for_run(name, Some(run_id))') &&
    singleSpeedCommand.includes('"healthStatus": "testing"') &&
    !singleSpeedCommand.includes('state.core.lock().unwrap().test_single_proxy_delay('),
  'slow TUIC/AnyTLS/single-node probes must not freeze the row or page'
);

check(
  'single-node direct failures settle without waiting forever for polling',
  testSingleNodeBody.includes('const runId = Number(queued?.runId || 0)') &&
    testSingleNodeBody.includes('runId > 0') &&
    testSingleNodeBody.includes('await waitForSingleNodeDelay(name, runId)') &&
    testSingleNodeBody.includes("queued?.lastFailureReason") &&
    testSingleNodeBody.includes("void captureNodeDiagnostics(name)") &&
    testSingleNodeBody.includes("applyOptimisticNodeDelay(name, Number(result?.delay ?? -1), reason)"),
  'when a backend returns a final failed probe without runId, UI must clear testing state and show diagnostics'
);

check(
  'speed polling and cancellation avoid the CoreManager mutex',
  speedStatusCommand.includes('speed_test_snapshot_from_state(&state.speed_test)') &&
    cancelSpeedCommand.includes('reset_speed_test_state_from_state(&state.speed_test') &&
    !speedStatusCommand.includes('core.lock') &&
    !cancelSpeedCommand.includes('core.lock'),
  'status/cancel are volatile UI operations and must stay lock-light'
);

check(
  'speed test UI does not use foreground busy or disabling wrappers',
  testNodesBody.includes("invoke('start_proxy_delay_test'") &&
    testNodesBody.includes('setInterval(pollSpeedTest, speedTestPollMs)') &&
    testNodesBody.includes('await pollSpeedTest()') &&
    !testNodesBody.includes('runForegroundAction') &&
    !testNodesBody.includes('runButtonAction') &&
    !testNodesBody.includes('.disabled = true'),
  'speed tests should feel detached while results stream back'
);

check(
  'diagnostics stays explicit, detached, and navigation-safe',
  diagnosticsPageLoad.includes("page === 'diagnostics'") &&
    diagnosticsPageLoad.includes('renderCachedDiagnostics();') &&
    !diagnosticsPageLoad.includes("runBackgroundJob('diagnostics'") &&
    runDiagnosticsBody.includes("runBackgroundJob('diagnostics'") &&
    runDiagnosticsBody.includes("isCurrentPageTask(token, 'diagnostics')") &&
    interactionSmoke.includes('running diagnostics blocked sidebar page switching'),
  'diagnostics may run in the background but cannot lock the user on the diagnostics page'
);

check(
  'button busy feedback stays visual instead of disabling controls',
  setButtonBusyBody.includes("button.classList.toggle('is-pending', busy)") &&
    setButtonBusyBody.includes("button.setAttribute('aria-busy', busy ? 'true' : 'false')") &&
    setButtonBusyBody.includes("button.dataset.busy = busy ? 'true' : ''") &&
    !setButtonBusyBody.includes('button.disabled = busy') &&
    interactionSmoke.includes('button became disabled during pending feedback'),
  'pending state should not make the app feel frozen'
);

check(
  'profile switching cancels stale speed work and previews nodes immediately',
  resetSpeedUiBody.includes('stopSpeedTestPolling()') &&
    resetSpeedUiBody.includes("latestSpeedStatus = null") &&
    appJs.includes('function previewProfileNodes') &&
    appJs.includes("invoke('preview_profile_groups'") &&
    speedAudit.includes('profile switching cancels stale speed tests') &&
    interactionSmoke.includes('quick subscription switch did not request local node preview'),
  'old subscription speed results must not bleed into the new subscription'
);

check(
  'proxy-group references are hidden from ordinary nodes and speed targets',
  appJs.includes('function isProxyGroupReferenceItem') &&
    appJs.includes('if (isProxyGroupReferenceItem(item)) continue;') &&
    mainRs.includes('fn is_proxy_group_reference_item') &&
    mainRs.includes('speed_targets_skip_proxy_group_references') &&
    speedAudit.includes('speed-test targets exclude proxy-group references'),
  'HK/JP/SG/TW/US strategy references are future routing data, not selectable nodes'
);

check(
  'release gate includes the stability lane and related audits',
  releaseAudit.includes('audit:stability') &&
    backendAudit.includes('batch speed-test command returns before slow core preparation') &&
    responsivenessAudit.includes('speed tests do not enter global foreground busy state') &&
    diagnosticsAudit.includes('diagnostics does expensive work outside the CoreManager lock'),
  'global release gate must keep the stability rules visible'
);

check(
  'runtime smoke covers the user-visible regressions directly',
  interactionSmoke.includes('speed test triggered a proxy switch') &&
    interactionSmoke.includes('batch speed test triggered a proxy switch') &&
    interactionSmoke.includes('home filter switch left rows stuck in testing state after speed test') &&
    interactionSmoke.includes('running diagnostics blocked sidebar page switching') &&
    perfSmoke.includes('i < 420') &&
    perfSmoke.includes('rapid navigation triggered diagnostics before quiet period'),
  'smoke tests should model the complaints, not only static code shape'
);

const failed = results.filter((item) => !item.ok);
console.log(JSON.stringify({
  ok: failed.length === 0,
  failed,
  passed: results.filter((item) => item.ok),
  generatedAt: new Date().toISOString()
}, null, 2));

if (failed.length) process.exit(1);
