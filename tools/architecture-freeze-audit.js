import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, detail });
}

const pkg = readJson('package.json');
const tauri = readJson('src-tauri/tauri.conf.json');
const capabilities = read('src-tauri/capabilities/default.json');
const mainRs = read('src-tauri/src/main.rs');
const coreRuntimeRs = read('src-tauri/src/core_runtime.rs');
const taskRuntimeRs = read('src-tauri/src/task_runtime.rs');
const speedRuntimeRs = read('src-tauri/src/speed_runtime.rs');
const appJs = read('src/app.js');
const indexHtml = read('src/index.html');
const stylesCss = read('src/styles.css');
const releaseAudit = read('tools/release-audit.js');
const interactionSmoke = read('tools/interaction-smoke.js');
const perfSmoke = read('tools/perf-smoke.js');
const testNodesBody = appJs.match(/async function testNodes\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] || '';
const speedStart = mainRs.indexOf('fn start_proxy_delay_test');
const speedEnd = mainRs.indexOf('fn test_single_proxy_delay', speedStart);
const speedTestBody = speedStart >= 0 && speedEnd > speedStart ? mainRs.slice(speedStart, speedEnd) : '';
const docPath = 'ARCHITECTURE_FREEZE_2.9.20_TO_2.9.29.md';
const freezeDoc = exists(docPath) ? read(docPath) : '';

const directLegacyInvokes = [
  'start_core',
  'stop_core',
  'restart_core',
  'set_system_proxy',
  'update_setting',
  'set_mode',
  'change_proxy',
];

const docSections = [
  '2.9.20 Feature freeze',
  'Freeze inventory',
  'Known risk list',
  'Architecture cleanup list',
  'Initial security threat model',
  '3.0 acceptance criteria',
  'Module boundary diagram',
  'Attack surface list',
  'Completion matrix',
];

check('2.9.20-2.9.29 freeze document exists', exists(docPath), docPath);
check('freeze document contains required sections', docSections.every((section) => freezeDoc.includes(section)), docSections.join(', '));
check('freeze document covers every freeze-lane patch version', Array.from({ length: 10 }, (_, i) => `2.9.${20 + i}`).every((version) => freezeDoc.includes(version)), '2.9.20..2.9.29');

check('release version has moved to post-freeze cleanup or guarded 3.x line', pkg.version === tauri.version && (/^2\.9\.(?:29|[3-9]\d+)$/.test(pkg.version) || /^3\.\d+\.\d+$/.test(pkg.version)), `${pkg.version}/${tauri.version}`);
check('release audit includes architecture gate', releaseAudit.includes('architecture freeze audit script exists') && releaseAudit.includes(docPath), 'tools/release-audit.js');
check('package exposes audit:architecture', pkg.scripts?.['audit:architecture'] === 'node tools/architecture-freeze-audit.js', 'package.json scripts');
check('debt-audit gate is wired for post-freeze cleanup', pkg.scripts?.['audit:debt'] === 'node tools/debt-audit.js' && releaseAudit.includes('debt audit script exists') && exists('tools/debt-audit.js'), 'debt-audit post-freeze gate');

check('frontend does not call legacy synchronous core commands directly', directLegacyInvokes.every((name) => !appJs.includes(`invoke('${name}'`) && !appJs.includes(`invoke("${name}"`)), directLegacyInvokes.join(', '));
check('backend exposes unified background job entrypoints', ['fn start_job', 'fn job_status', 'fn cancel_job', 'fn lock_operation_queue'].every((token) => mainRs.includes(token)), 'start_job/job_status/cancel_job/operation queue');
check('background job state model is centralized in task_runtime', mainRs.includes('jobs: JobStore') && mainRs.includes('job_status_snapshot(&state.jobs, id)') && mainRs.includes('request_job_cancel(&state.jobs, &id)') && taskRuntimeRs.includes('pub struct JobRecord') && taskRuntimeRs.includes('pub fn finish_job(') && taskRuntimeRs.includes('pub fn request_job_cancel(') && !mainRs.includes('struct JobRecord') && !mainRs.includes('fn finish_job('), 'task_runtime job state/cancel/status model');
check('speed-test state model is centralized in speed_runtime', mainRs.includes('mod speed_runtime') && mainRs.includes('speed_test: SpeedTestStore') && mainRs.includes('speed_test_runtime_snapshot(&state.speed_test, now_secs())') && speedRuntimeRs.includes('pub struct SpeedTestState') && speedRuntimeRs.includes('pub struct NodeHealth') && speedRuntimeRs.includes('pub fn speed_test_snapshot(') && speedRuntimeRs.includes('pub fn fail_speed_test_if_current(') && !mainRs.includes('struct SpeedTestState') && !mainRs.includes('fn speed_test_snapshot_from_state'), 'speed_runtime speed state/cancel/status model');
check('foreground and detached frontend task helpers are present', ['runBackgroundJob', 'runForegroundAction', 'runDetachedButtonAction', 'foregroundBusy', 'backgroundJobBusy'].every((token) => appJs.includes(token)), 'frontend task model');
check('optimistic UI model is centralized', ['runOptimisticAction', 'snapshotUiState', 'restoreUiState', 'applyOptimisticSetting', 'renderUiState', 'uiStore'].every((token) => appJs.includes(token)), 'optimistic UI layer');
check('buttons use non-blocking pending state instead of disabling', appJs.includes('function setButtonBusy') && appJs.includes("aria-busy") && appJs.includes("dataset.busy") && !appJs.includes('button.disabled = busy'), 'setButtonBusy');
check('sidebar navigation stays deferred and token guarded', ['pointerdown', 'schedulePageLoad', 'pageLoadToken', 'renderedPage', 'scheduleRowsRender'].every((token) => appJs.includes(token)), 'deferred navigation');

check('connection state closure is the shared truth surface', ['fn connection_closure', 'core_runtime::connection_status_json', 'core_runtime::connection_closure_json'].every((token) => mainRs.includes(token)) && ['pub fn connection_status_json', 'pub fn connection_closure_json', '"coreRunning"', '"trafficTakeover"', '"systemProxyApplied"', '"currentNode"', '"outboundIpKnown"'].every((token) => coreRuntimeRs.includes(token)), 'connection_closure');
check('system proxy takeover is verified and recoverable', ['verify_system_proxy_points_to_aegos', 'capture_proxy_snapshot_before_takeover', 'write_windows_proxy_snapshot', 'repairSystemProxy'].every((token) => mainRs.includes(token) || appJs.includes(token)), 'system proxy transaction');
check('disconnect protection firewall is wrapped and verifiable', ['build_speed_test_firewall_script', 'Invoke-AegosNetsh', 'Disconnect protection enable failed', 'cleanup_speed_firewall'].every((token) => mainRs.includes(token)), 'firewall wrapper');
check('speed tests are measurement-only and use standby core path', ['fn start_standby', 'fn ensure_core_for_delay_test', 'core_runtime::STANDBY_SPEED_START_MESSAGE'].every((token) => mainRs.includes(token)) && coreRuntimeRs.includes('pub const STANDBY_SPEED_START_MESSAGE') && testNodesBody.includes("invoke('start_proxy_delay_test'") && !testNodesBody.includes("runBackgroundJob('changeProxy'") && !speedTestBody.includes('change_proxy') && interactionSmoke.includes('speed test triggered a proxy switch') && interactionSmoke.includes('batch speed test triggered a proxy switch'), 'standby speed test');
check('outbound IP lookup has current-node smart-mode routing', ['AEGOS_OUTBOUND_IP_GROUP', 'OUTBOUND_IP_RULE_DOMAINS', 'upsert_outbound_ip_group', 'sync_outbound_ip_group_selection'].every((token) => mainRs.includes(token)), 'outbound IP group');

check('runtime config chain uses preflight, hot reload, digest, rollback', ['patch_config_with_settings', 'preflight_runtime_config', 'hot_reload_profile', 'runtime_config_digest', 'Profile hot reload failed; falling back to restart', 'Profile switch failed and rolled back'].every((token) => mainRs.includes(token)), 'profile config chain');
check('legacy profile file patch path is removed after cleanup', !mainRs.includes('patch_profile_file_legacy') && !mainRs.includes('#[allow(dead_code)]'), 'legacy patch path deleted instead of fenced');
check('critical defaults keep local controller private', mainRs.includes('AEGOS_DEFAULT_MIXED_PORT: u16 = 7891') && mainRs.includes('external-controller') && mainRs.includes('127.0.0.1') && mainRs.includes('allow-lan') && mainRs.includes('false'), 'ports/controller/allow-lan');

check('logs and diagnostics are layered and exportable', ['DiagnosticsSnapshot', 'diagnostics_detached', 'diagnosticReportText', 'export_logs', 'logCategoryLabel'].every((token) => mainRs.includes(token) || appJs.includes(token)), 'diagnostics/logs');
check('sensitive data is sanitized before logs and reports', ['fn sanitize_sensitive_text', 'redact_after_key', 'redact_uri_userinfo', 'log_sanitizer_redacts_subscription_and_node_secrets', 'sanitize_sensitive_text(&line)'].every((token) => mainRs.includes(token)), 'log/report redaction');
check('frontend escapes dynamic template data', appJs.includes('function escapeHtml') && !/(outerHTML|insertAdjacentHTML|document\.write|new Function|eval\()/m.test(appJs), 'template guardrails');

check('Tauri CSP and capability surface stay constrained', tauri.app?.security?.csp?.includes("default-src 'self'") && tauri.app?.security?.csp?.includes('connect-src ipc: http://ipc.localhost') && capabilities.includes('core:window:allow-start-dragging') && !capabilities.includes('shell:allow-open'), 'CSP/capabilities');
check('PowerShell runs through single hidden launcher with runtime-owned escaping helpers', (mainRs.match(/Command::new\("powershell\.exe"\)/g) || []).length === 1 && mainRs.includes('fn run_powershell') && mainRs.includes('CREATE_NO_WINDOW') && mainRs.includes('core_runtime::powershell_single_quote_escape') && !mainRs.includes('fn ps_escape'), 'PowerShell launcher');

check('interaction/performance/soak stress gates exist', ['smoke:interactions', 'smoke:perf', 'smoke:soak', 'smoke:ui', 'audit:security'].every((script) => Object.prototype.hasOwnProperty.call(pkg.scripts, script)) && perfSmoke.includes('i < 420') && interactionSmoke.includes('running diagnostics blocked sidebar page switching'), 'stress scripts');
check('layout uses stable inactive page isolation', stylesCss.includes('.page.active') && stylesCss.includes('position: absolute') && stylesCss.includes('contain: layout paint'), 'page isolation/layout containment');
check('routing page is read-only when present', (!indexHtml.includes('data-page="routing"') || (pkg.scripts?.['audit:routing-readonly'] === 'node tools/routing-readonly-audit.js' && releaseAudit.includes('routing read-only audit script exists'))) && !indexHtml.includes('data-page="rules"') && !appJs.includes('customRule') && !mainRs.includes('save_routing_rule'), 'feature freeze/read-only routing');

const result = {
  ok: fail.length === 0,
  passed: pass,
  failed: fail,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
