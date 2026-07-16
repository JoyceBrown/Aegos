import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const interactionSmoke = fs.readFileSync(path.join(root, 'tools', 'interaction-smoke.js'), 'utf8');
const releaseAudit = fs.readFileSync(path.join(root, 'tools', 'release-audit.js'), 'utf8');

const fail = [];
const pass = [];

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

function bodyOf(source, name) {
  const match = source.match(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`));
  return match?.[1] || '';
}

const resetBody = bodyOf(appJs, 'resetSpeedUiForProfileSwitch');
const previewBody = bodyOf(appJs, 'previewProfileNodes');
const scheduleRowsBody = bodyOf(appJs, 'scheduleRowsRender');
const initBody = bodyOf(appJs, 'initializeAppData');
const singleNodeBody = bodyOf(appJs, 'testSingleNode');
const positionProfileBody = bodyOf(appJs, 'positionQuickProfileMenu');

check(
  'batch speed uses a bounded streaming scheduler',
  mainRs.includes('const FLCLASH_STYLE_TEST_URL') &&
    mainRs.includes('https://www.gstatic.com/generate_204') &&
    mainRs.includes('SPEED_GLOBAL_CONCURRENCY_INITIAL') &&
    mainRs.includes('SPEED_GLOBAL_CONCURRENCY_MAX') &&
    mainRs.includes('speed_test_ordered_targets') &&
    mainRs.includes('next_schedulable_target') &&
    mainRs.includes('emit_speed_test_event') &&
    mainRs.includes('assert_eq!(fast_tuic_probes.len(), 1)'),
  'batch speed must stream a single-URL first pass without phase barriers or unbounded concurrency'
);

check(
  'single-node diagnostics keep deep retry while batch stays fast',
  mainRs.includes('fn test_proxy_delay_fast') &&
    mainRs.includes('fn test_proxy_delay_with_retry') &&
    mainRs.includes('fn test_proxy_delay_plan') &&
    mainRs.includes('DelayProbeDepth::Fast') &&
    mainRs.includes('DelayProbeDepth::Full') &&
    mainRs.includes('let fast_result =') &&
    mainRs.includes('test_proxy_delay_plan(client, controller, name, protocol, DelayProbeDepth::Fast)') &&
    mainRs.includes('test_proxy_delay_with_retry('),
  'batch and single-node speed tests intentionally serve different user needs'
);

check(
  'startup uses local profile preview before verified proxy refresh',
  appJs.includes('async function initializeAppData') &&
    initBody.includes('const statusReady = refreshStatus(true)') &&
    initBody.includes("refreshNodes(true, { delay: 0, target: 'home' })") &&
    initBody.includes('await Promise.all([') &&
    appJs.includes('.then(() => initializeAppData())'),
  'home common nodes should not wait for the full controller refresh on app start'
);

check(
  'subscription switching does not blank the node lists',
  resetBody.includes('beginNodeListTransition()') &&
    !resetBody.includes('renderRows([])') &&
    !resetBody.includes('renderHomeNodeSummary([])') &&
    previewBody.includes('transition: true') &&
    scheduleRowsBody.includes('pendingRowTransition') &&
    stylesCss.includes('.node-list-transitioning'),
  'old rows should fade while preview rows replace them, avoiding harsh flashes'
);

check(
  'speed results are shared and rendered incrementally',
  appJs.includes("listen('aegos-speed-test', handleSpeedTestEvent)") &&
    appJs.includes('function flushSpeedResultEvents') &&
    appJs.includes('requestAnimationFrame(flushSpeedResultEvents)') &&
    appJs.includes('function applySpeedStatusToNodes') &&
    appJs.includes('preserveLatest: true') &&
    appJs.includes('updateVisibleNodeDelays(visibleChanges)') &&
    interactionSmoke.includes('home page did not receive node batch speed results') &&
    interactionSmoke.includes('node page did not receive quick home speed results'),
  'home and node pages must share the same speed result stream'
);

check(
  'slow single-node speed test is not global foreground busy',
  singleNodeBody.includes('runLocalButtonAction') &&
    singleNodeBody.includes('waitForSingleNodeDelay') &&
    !singleNodeBody.includes('runButtonAction') &&
    singleNodeBody.includes('queueNodeRefresh(activeNodeRenderTarget(), 0)') &&
    interactionSmoke.includes('single node speed test blocked sidebar page switching'),
  'a slow failed node may busy its own icon while the result is polled from shared speed state'
);

check(
  'node page subscription switch reuses the quick subscription menu',
  indexHtml.includes('id="nodeProfileBtn"') &&
    appJs.includes("$('#nodeProfileBtn')?.addEventListener('pointerdown'") &&
    appJs.includes('profileMenuAnchor') &&
    positionProfileBody.includes("profileMenuAnchor || $('#quickProfileBtn') || $('#nodeProfileBtn')") &&
    interactionSmoke.includes('node page subscription button did not open the shared menu') &&
    stylesCss.includes('.node-profile-switch'),
  'node page switch button must not fork subscription menu logic'
);

check(
  'global release gate includes node-flow audit',
  releaseAudit.includes('node-flow audit is wired') &&
    releaseAudit.includes('node-flow-audit.js'),
  'release audit must fail if this specialized gate is removed'
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
