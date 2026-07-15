import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = [];
const pass = [];

const expectedVersion = 'v1.19.28';
const expectedSha256 = 'c14bda8dc4cc8910ccd2110fe2be083c51a1b66da59141a0b87aff6fe6126517';
const coreRel = path.join('resources', 'core', 'mihomo.exe');
const corePath = path.join(root, coreRel);

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const packageJson = readJson('package.json');
const tauri = readJson('src-tauri/tauri.conf.json');
const mainRs = read('src-tauri/src/main.rs');
const coreRuntimeRs = read('src-tauri/src/core_runtime.rs');
const releaseAudit = read('tools/release-audit.js');
const activeConnectionCommandBody = mainRs.match(/fn active_connection_count\(state: State<AppState>\) -> Result<JsonValue, String> \{([\s\S]*?)\n\}/)?.[1] || '';

function hasControllerCall(method, timeout) {
  return new RegExp(`controller\\s*\\.\\s*${method}\\(\\s*${timeout}\\s*\\)`).test(mainRs);
}

function hasControllerCallWithArg(method, arg, timeout) {
  return new RegExp(`controller\\s*\\.\\s*${method}\\(\\s*${arg}\\s*,\\s*${timeout}\\s*\\)`).test(mainRs);
}

const exists = fs.existsSync(corePath);
const actualSha = exists ? sha256(corePath) : '';
let versionOutput = '';
if (exists) {
  try {
    versionOutput = execFileSync(corePath, ['-v'], { encoding: 'utf8', timeout: 2500 });
  } catch (err) {
    versionOutput = String(err?.message || err);
  }
}

check('core binary exists in resources/core', exists, coreRel);
check('core binary hash matches the approved managed asset', actualSha === expectedSha256, actualSha);
check('core binary reports the approved version', versionOutput.includes(`Mihomo Meta ${expectedVersion}`), versionOutput.trim());
check('core binary keeps gVisor tag', versionOutput.includes('with_gvisor'), versionOutput.trim());
check(
  'Tauri bundles only the managed mihomo dataplane resource',
  tauri.bundle?.resources?.['../resources/core/mihomo.exe'] === 'core/mihomo.exe' &&
    !tauri.bundle?.resources?.['../resources/core/archive'],
  JSON.stringify(tauri.bundle?.resources || {}),
);
check(
  'Aegos exposes core runtime identity through status and command',
  [
    'pub const ENGINE: &str = "mihomo"',
    'pub const ROLE: &str = "Aegos Network Engine dataplane"',
    `pub const EXPECTED_VERSION: &str = "${expectedVersion}"`,
    'pub const RESOURCE_SUBDIR: &str = "core"',
    'pub const BINARY_NAME: &str = "mihomo.exe"',
    'pub const MISSING_RESOURCE_HINT',
    'pub const TERMINATE_FAILED_STARTUP_MESSAGE',
    'pub const CONTROLLER_READY_TIMEOUT_MESSAGE',
    'pub const STANDBY_SPEED_START_MESSAGE',
    'pub const RUNTIME_DRIFT_RESTART_MESSAGE',
    'pub const READY_CHECK_ATTEMPTS',
    'pub const READY_PROBE_TIMEOUT_MS',
    'pub const READY_RETRY_INTERVAL_MS',
    'pub const READY_REUSE_PROBE_TIMEOUT_MS',
    'pub const RUNTIME_RESTART_SETTLE_MS',
    'pub fn core_missing_message',
    'pub fn process_exit_message',
    'pub fn hot_reload_success_message',
    'runtime_lifecycle_messages_are_owned_by_runtime_boundary',
    expectedSha256,
    'pub struct CoreRuntimeContract',
    'pub fn identity_json',
    'pub fn runtime_status_json',
    'pub fn resolve_core_path',
    'runtime_core_resource_paths_are_owned_by_runtime_boundary',
    'fn core_runtime_info(&self) -> JsonValue',
    'CoreRuntimeContract::default()',
    'core_runtime::runtime_status_json',
    'core_runtime::resolve_core_path',
    'core_runtime::MISSING_RESOURCE_HINT',
    '#[tauri::command]\nfn core_runtime_info',
    'core_runtime_info,',
  ].every((token) => mainRs.includes(token) || coreRuntimeRs.includes(token)),
  'core runtime identity is not fully wired',
);
check(
  'Aegos routes controller access through the CoreController adapter',
  coreRuntimeRs.includes('pub struct CoreController') &&
    coreRuntimeRs.includes('pub fn controller_request') &&
    coreRuntimeRs.includes('pub fn traffic_snapshot(&self, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn connections_snapshot(&self, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn connections_snapshot_or_empty(&self, running: bool, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn recent_rule_hits_snapshot(') &&
    coreRuntimeRs.includes('pub fn routing_recent_rule_hits_snapshot_or_empty(&self, running: bool)') &&
    coreRuntimeRs.includes('pub fn recent_rule_hits_from_connections(') &&
    coreRuntimeRs.includes('pub fn active_connection_count(&self, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn active_connection_count_snapshot_or_idle(') &&
    coreRuntimeRs.includes('pub fn close_connection(&self, id: &str, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn close_connections(&self, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn status_traffic_snapshot(&self)') &&
    coreRuntimeRs.includes('pub fn status_traffic_snapshot_or_idle(') &&
    coreRuntimeRs.includes('pub fn idle_traffic_snapshot()') &&
    coreRuntimeRs.includes('pub fn ui_connections_snapshot_or_empty(&self, running: bool)') &&
    coreRuntimeRs.includes('pub fn home_active_connection_count_snapshot_or_idle(&self, running: bool)') &&
    coreRuntimeRs.includes('pub const STATUS_TRAFFIC_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub const CONNECTIONS_SNAPSHOT_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub const ROUTING_RECENT_RULES_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub const ROUTING_RECENT_RULES_LIMIT') &&
    coreRuntimeRs.includes('pub const ACTIVE_CONNECTION_COUNT_TIMEOUT_MS') &&
    mainRs.includes('fn core_controller(&self) -> core_runtime::CoreController') &&
    mainRs.includes('self.core_controller()') &&
    !mainRs.includes('.request(method, endpoint, body, timeout_ms)') &&
    !mainRs.includes('fn controller(') &&
    !mainRs.includes('fn controller_request(') &&
    !mainRs.includes('self.controller(') &&
    !mainRs.includes('fn traffic_snapshot(&self)') &&
    mainRs.includes('.status_traffic_snapshot_or_idle(running, &self.last_traffic)') &&
    mainRs.includes('controller.ui_connections_snapshot_or_empty(running)') &&
    mainRs.includes('controller.home_active_connection_count_snapshot_or_idle(running)') &&
    mainRs.includes('.routing_recent_rule_hits_snapshot_or_empty(running)') &&
    !mainRs.includes('diagnostic_connections_snapshot') &&
    !activeConnectionCommandBody.includes('now_secs') &&
    mainRs.includes('controller.close_connection_for_ui(&id)') &&
    mainRs.includes('controller.close_all_connections_for_ui()') &&
    coreRuntimeRs.includes('pub fn close_connection_for_ui(&self, id: &str)') &&
    coreRuntimeRs.includes('pub fn close_all_connections_for_ui(&self)') &&
    coreRuntimeRs.includes('pub const CLOSE_CONNECTION_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub const CLOSE_ALL_CONNECTIONS_TIMEOUT_MS') &&
    !mainRs.includes('Client::builder()\n        .no_proxy()\n        .timeout(Duration::from_millis(timeout_ms))\n        .build()'),
  'controller calls must go through core_runtime instead of rebuilding ad-hoc clients',
);
check(
  'Aegos routes proxy control APIs through typed CoreController methods',
  coreRuntimeRs.includes('pub fn proxies_snapshot(&self, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn proxy_groups_snapshot(') &&
    coreRuntimeRs.includes('fn normalize_proxy_item') &&
    coreRuntimeRs.includes('pub fn select_proxy(&self, group: &str, proxy: &str, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn apply_proxy_selection(&self, group: &str, proxy: &str)') &&
    coreRuntimeRs.includes('pub fn apply_proxy_selection_with_cleanup(') &&
    coreRuntimeRs.includes('self.apply_proxy_selection(group, proxy)?') &&
    coreRuntimeRs.includes('self.cleanup_stale_connections_after_selection();') &&
    coreRuntimeRs.includes('pub fn apply_auxiliary_proxy_selection(&self, group: &str, proxy: &str)') &&
    coreRuntimeRs.includes('pub fn cleanup_stale_connections_after_selection(&self)') &&
    coreRuntimeRs.includes('pub const PROXY_SELECT_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub const AUXILIARY_PROXY_SELECT_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub const STALE_CONNECTION_CLEANUP_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub fn ui_proxy_groups_snapshot(') &&
    coreRuntimeRs.includes('pub fn ui_proxy_groups_snapshot_or_none(') &&
    coreRuntimeRs.includes('pub const PROXY_GROUPS_SNAPSHOT_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub fn proxy_delay_with_client(') &&
    coreRuntimeRs.includes('pub fn proxy_delay_result_with_client(') &&
    coreRuntimeRs.includes('pub fn classify_delay_http_failure(') &&
    mainRs.includes('.ui_proxy_groups_snapshot_or_none(running, &[AEGOS_OUTBOUND_IP_GROUP])') &&
    !mainRs.includes('fn controller_proxy_groups_snapshot') &&
    !mainRs.includes('.ui_proxy_groups_snapshot(&[AEGOS_OUTBOUND_IP_GROUP])') &&
    !mainRs.includes('.proxy_groups_snapshot(1200, &[AEGOS_OUTBOUND_IP_GROUP])') &&
    !mainRs.includes('.proxies_snapshot(1200)') &&
    !mainRs.includes('fn normalize_proxy_item') &&
    mainRs.includes('.proxy_delay_result_with_client(client, name, test_url, timeout_ms)') &&
    !mainRs.includes('fn classify_delay_http_failure') &&
    mainRs.includes('.apply_auxiliary_proxy_selection(') &&
    mainRs.includes('.apply_proxy_selection_with_cleanup(group, proxy)') &&
    !mainRs.includes('.apply_proxy_selection(group, proxy)') &&
    !mainRs.includes('.cleanup_stale_connections_after_selection()') &&
    !mainRs.includes('.select_proxy(AEGOS_OUTBOUND_IP_GROUP, &proxy, 1500)') &&
    !mainRs.includes('.select_proxy(group, proxy, 5000)') &&
    !mainRs.includes('.close_connections(1500)') &&
    !mainRs.includes('controller_request(controller_port, secret, "GET", "/proxies"') &&
    !mainRs.includes('http://127.0.0.1:{}/proxies/{}/delay') &&
    !/self\.controller\(\s*"PUT"\s*,\s*&format!\("\/proxies\//.test(mainRs),
  'proxy groups, delay probes, and explicit node selection must stay behind core_runtime typed APIs',
);
check(
  'Aegos routes readiness and mode control through typed CoreController methods',
  coreRuntimeRs.includes('pub fn version_probe(&self, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn runtime_reuse_ready(&self) -> bool') &&
    coreRuntimeRs.includes('self.version_probe(READY_REUSE_PROBE_TIMEOUT_MS).is_ok()') &&
    coreRuntimeRs.includes('pub fn wait_until_ready') &&
    coreRuntimeRs.includes('pub fn process_exit_message') &&
    coreRuntimeRs.includes('pub const READY_REUSE_PROBE_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub const READY_PROBE_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub const READY_CHECK_ATTEMPTS') &&
    coreRuntimeRs.includes('pub const READY_RETRY_INTERVAL_MS') &&
    coreRuntimeRs.includes('pub const RUNTIME_RESTART_SETTLE_MS') &&
    coreRuntimeRs.includes('pub fn set_mode(&self, mode: &str, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn apply_mode(&self, mode: &str)') &&
    coreRuntimeRs.includes('pub fn apply_mode_if_running(') &&
    coreRuntimeRs.includes('Some(self.apply_mode(mode))') &&
    coreRuntimeRs.includes('pub const MODE_APPLY_TIMEOUT_MS') &&
    mainRs.includes('.wait_until_ready(||') &&
    mainRs.includes('.runtime_reuse_ready()') &&
    !mainRs.includes('core_runtime::READY_REUSE_PROBE_TIMEOUT_MS') &&
    mainRs.includes('core_runtime::RUNTIME_RESTART_SETTLE_MS') &&
    mainRs.includes('.apply_mode_if_running(self.process.is_some(), mode)') &&
    !mainRs.includes('self.core_controller().apply_mode(mode)') &&
    !mainRs.includes('self.core_controller().set_mode(mode, 3000)') &&
    !mainRs.includes('version_probe(900)') &&
    !mainRs.includes('version_probe(300)') &&
    !mainRs.includes('for _ in 0..24') &&
    !mainRs.includes('fn controller(') &&
    !mainRs.includes('self.controller('),
  'main.rs must not keep a generic controller escape hatch for /version, /configs, or /connections',
);
check(
  'Aegos starts the dataplane through a CoreLaunchPlan',
  coreRuntimeRs.includes('pub struct CoreLaunchPlan') &&
    coreRuntimeRs.includes('pub fn launch_command') &&
    coreRuntimeRs.includes('.stdin(Stdio::null())') &&
    coreRuntimeRs.includes('.stdout(Stdio::piped())') &&
    coreRuntimeRs.includes('.stderr(Stdio::piped())') &&
    mainRs.includes('CoreLaunchPlan::new') &&
    mainRs.includes('.display_label()') &&
    mainRs.includes('.command()') &&
    !mainRs.includes('Command::new(&self.core_path)'),
  'dataplane process launch must be planned by core_runtime',
);
check(
  'Aegos normalizes runtime profile YAML through the core runtime boundary',
  coreRuntimeRs.includes('pub struct CoreRuntimeProfile') &&
    coreRuntimeRs.includes('pub fn render_runtime_profile_yaml') &&
    coreRuntimeRs.includes('fn apply_interface_binding') &&
    coreRuntimeRs.includes('fn sha256_text') &&
    mainRs.includes('core_runtime::render_runtime_profile_yaml') &&
    !mainRs.includes('fn apply_runtime_interface_binding_name') &&
    !mainRs.includes('serde_yaml::from_str(&rendered.yaml)'),
  'runtime YAML normalization, interface binding, and runtime digest must stay inside core_runtime',
);
check(
  'Aegos writes runtime profile files through the core runtime boundary',
  coreRuntimeRs.includes('pub struct CoreRuntimeProfileWrite') &&
    coreRuntimeRs.includes('pub fn write_runtime_profile') &&
    coreRuntimeRs.includes('fn atomic_write_text_confined') &&
    coreRuntimeRs.includes('fn ensure_path_within') &&
    coreRuntimeRs.includes('refusing to write runtime profile outside core home') &&
    mainRs.includes('core_runtime::write_runtime_profile') &&
    !mainRs.includes('atomic_write_text_confined(&runtime_path, &self.home_dir'),
  'runtime profile writes must be path-confined and owned by core_runtime',
);
check(
  'Aegos applies runtime profiles through an audited core runtime transaction',
  coreRuntimeRs.includes('pub struct CoreRuntimeApplyTransaction') &&
    coreRuntimeRs.includes('pub struct CoreRuntimeApplyResult') &&
    coreRuntimeRs.includes('pub fn apply(&self, controller: &CoreController)') &&
    coreRuntimeRs.includes('pub const CONFIG_FORCE_APPLY_ENDPOINT') &&
    coreRuntimeRs.includes('pub const CONFIG_FORCE_APPLY_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub const CONFIG_APPLY_VERSION_PROBE_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub fn apply_runtime_config_path(&self, path: &Path)') &&
    coreRuntimeRs.includes('pub fn config_apply_version_probe(&self)') &&
    coreRuntimeRs.includes('controller.apply_runtime_config_path(&self.runtime_profile_path)') &&
    coreRuntimeRs.includes('controller.config_apply_version_probe()') &&
    !coreRuntimeRs.includes('controller.request("GET", "/version", None, 900)') &&
    !coreRuntimeRs.includes('Some(json!({ "path": self.runtime_profile_path.to_string_lossy().to_string() })),\n            8000') &&
    mainRs.includes('CoreRuntimeApplyTransaction::new') &&
    mainRs.includes('apply_transaction.apply(&self.core_controller())') &&
    !mainRs.includes('"/configs?force=true"'),
  'runtime config apply must be owned by core_runtime instead of ad-hoc controller calls in main.rs',
);
check(
  'release gate requires core runtime audit',
  packageJson.scripts?.['audit:core-runtime'] === 'node tools/core-runtime-audit.js' &&
    releaseAudit.includes('core runtime audit script exists'),
  'package.json/tools/release-audit.js',
);

const result = {
  ok: fail.length === 0,
  expectedVersion,
  expectedSha256,
  actualSha,
  versionOutput: versionOutput.trim(),
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
