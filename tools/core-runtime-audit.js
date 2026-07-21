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
const CORE_VERSION_PROBE_AUDIT_TIMEOUT_MS = 7500;
const coreRel = path.join('resources', 'core', 'mihomo.exe');
const corePath = path.join(root, coreRel);

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
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
const coreDomainRs = read('src-tauri/src/core_domain.rs');
const coreRuntimeRs = read('src-tauri/src/core_runtime.rs');
const dataplaneRs = read('src-tauri/src/dataplane.rs');
const storageRuntimeRs = read('src-tauri/src/storage_runtime.rs');
const configPipelineRs = read('src-tauri/src/config_pipeline.rs');
const releaseAudit = read('tools/release-audit.js');
const activeConnectionCommandBody = mainRs.match(/fn active_connection_count\(state: State<AppState>\) -> Result<JsonValue, String> \{([\s\S]*?)\n\}/)?.[1] || '';
const startWithTakeoverBody = mainRs.match(/fn start_with_takeover\(&mut self, enable_takeover: bool\) -> Result<JsonValue, String> \{([\s\S]*?)\n    fn terminate_core_process/)?.[1] || '';
const stopBody = mainRs.match(/fn stop\(&mut self\) -> Result<JsonValue, String> \{([\s\S]*?)\n    fn shutdown_for_exit/)?.[1] || '';
const probeProxyNetworkBody = mainRs.match(/fn probe_proxy_network\(&self, timeout_ms: u64\) -> JsonValue \{([\s\S]*?)\n    fn recovery_candidates/)?.[1] || '';
const recoveryCandidatesBody = mainRs.match(/fn recovery_candidates\(&self\) -> Vec<\(String, String, i64\)> \{([\s\S]*?)\n    fn recovery_suggestions_from_groups/)?.[1] || '';
const tryRecoverCurrentProfileBody = mainRs.match(/fn try_recover_current_profile\(&mut self\) -> Result<Option<JsonValue>, String> \{([\s\S]*?)\n    fn recover_network/)?.[1] || '';
const recoverNetworkBody = mainRs.match(/fn recover_network\(&mut self, force: bool\) -> Result<JsonValue, String> \{([\s\S]*?)\n    fn change_proxy/)?.[1] || '';
const repairSystemProxyTakeoverBody = mainRs.match(/fn repair_system_proxy_takeover\(&mut self\) -> Result<JsonValue, String> \{([\s\S]*?)\n    fn apply_setting_value/)?.[1] || '';
const hotReloadProfileBody = mainRs.match(/fn hot_reload_profile\(&mut self, profile: &Profile\) -> Result<JsonValue, String> \{([\s\S]*?)\n    fn ensure_runtime_ports/)?.[1] || '';
const restartCorePreservingProxyBody = mainRs.match(/fn restart_core_preserving_proxy\(&mut self, delay_ms: u64\) -> Result<JsonValue, String> \{([\s\S]*?)\n    fn start_from_restart_plan/)?.[1] || '';
const startFromRestartPlanBody = mainRs.match(/fn start_from_restart_plan\(\n\s*&mut self,\n\s*restart_plan: core_runtime::CoreRuntimeRestartPlan,\n\s*\) -> Result<JsonValue, String> \{([\s\S]*?)\n    fn stop/)?.[1] || '';
const setActiveProfileBody = mainRs.match(/fn set_active_profile\(&mut self, id: &str\) -> Result<Profile, String> \{([\s\S]*?)\n    fn rename_profile/)?.[1] || '';
const removeProfileBody = mainRs.match(/fn remove_profile\(&mut self, id: &str\) -> Result<bool, String> \{([\s\S]*?)\n    fn save_manual_node/)?.[1] || '';
const addProfileUrlDetachedBody = mainRs.match(/fn add_profile_url_detached\([\s\S]*?\) -> Result<Profile, String> \{([\s\S]*?)\nfn update_profile_detached/)?.[1] || '';
const updateProfileDetachedBody = mainRs.match(/fn update_profile_detached\([\s\S]*?\) -> Result<Profile, String> \{([\s\S]*?)\nfn refresh_outbound_ip_detached/)?.[1] || '';
const speedTestStart = mainRs.indexOf('fn start_proxy_delay_test_for_run');
const speedTestEnd = mainRs.indexOf('fn probe_proxy_network', speedTestStart);
const speedTestBody = speedTestStart >= 0 && speedTestEnd > speedTestStart
  ? mainRs.slice(speedTestStart, speedTestEnd)
  : '';

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
    versionOutput = execFileSync(corePath, ['-v'], {
      encoding: 'utf8',
      timeout: CORE_VERSION_PROBE_AUDIT_TIMEOUT_MS,
    });
  } catch (err) {
    versionOutput = String(err?.message || err);
  }
}

check('core binary exists in resources/core', exists, coreRel);
check('core binary hash matches the approved managed asset', actualSha === expectedSha256, actualSha);
check(
  'core binary version probe has a Windows cold-start audit SLA',
  CORE_VERSION_PROBE_AUDIT_TIMEOUT_MS >= 7500 && CORE_VERSION_PROBE_AUDIT_TIMEOUT_MS <= 10000,
  `${CORE_VERSION_PROBE_AUDIT_TIMEOUT_MS}ms`,
);
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
    'pub(crate) const ENGINE: &str = "mihomo"',
    'pub const ROLE: &str = "Aegos Network Engine dataplane"',
    `pub(crate) const EXPECTED_VERSION: &str = "${expectedVersion}"`,
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
    'pub fn status_surface_json',
    'pub fn resolve_core_path',
    'runtime_core_resource_paths_are_owned_by_runtime_boundary',
    'fn core_runtime_info(&self) -> JsonValue',
    'CoreRuntimeContract::default()',
    'core_runtime::status_surface_json',
    'core_runtime::resolve_core_path',
    'core_runtime::MISSING_RESOURCE_HINT',
    '#[tauri::command]\nfn core_runtime_info',
    'core_runtime_info,',
  ].every((token) => mainRs.includes(token) || coreRuntimeRs.includes(token) || dataplaneRs.includes(token)),
  'core runtime identity is not fully wired',
);
check(
  'Aegos routes controller access through the CoreController adapter',
  dataplaneRs.includes('pub(crate) trait DataplaneControl') &&
    coreRuntimeRs.includes('impl DataplaneControl for CoreController') &&
  coreRuntimeRs.includes('pub struct CoreController') &&
    coreRuntimeRs.includes('#[derive(Clone, Debug)]') &&
    coreRuntimeRs.includes('pub struct CoreController') &&
    coreRuntimeRs.includes('fn controller_request(') &&
    !coreRuntimeRs.includes('pub fn controller_request') &&
    coreRuntimeRs.includes('fn request(') &&
    !coreRuntimeRs.includes('pub fn request(') &&
    coreRuntimeRs.includes('pub fn traffic_snapshot(&self, timeout_ms: u64)') &&
    coreDomainRs.includes('pub struct TrafficSnapshot') &&
    coreDomainRs.includes('pub fn traffic_snapshot_from_controller_line') &&
    coreRuntimeRs.includes('Result<TrafficSnapshot, String>') &&
    coreRuntimeRs.includes('pub fn connections_snapshot(&self, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn connections_snapshot_or_empty(') &&
    coreRuntimeRs.includes('pub fn recent_rule_hits_snapshot(') &&
    coreRuntimeRs.includes('pub fn routing_recent_rule_hits_snapshot_or_empty(&self, running: bool)') &&
    coreDomainRs.includes('pub struct ConnectionSnapshot') &&
    coreDomainRs.includes('pub fn connection_snapshots_from_controller') &&
    coreDomainRs.includes('pub fn recent_rule_hits') &&
    coreRuntimeRs.includes('Result<Vec<ConnectionSnapshot>, String>') &&
    !coreRuntimeRs.includes('recent_rule_hits_from_connections') &&
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
    mainRs.includes('.status_traffic_snapshot_or_idle(observed_running, &previous_traffic)') &&
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
  'Aegos owns routing group row shaping inside the core runtime boundary',
  coreRuntimeRs.includes('pub fn canonical_strategy_type(') &&
    coreRuntimeRs.includes('pub fn routing_group_rows(') &&
    coreRuntimeRs.includes('pub fn routing_group_counts(') &&
    coreRuntimeRs.includes('fn is_internal_routing_group_name') &&
    coreRuntimeRs.includes('routing_group_rows_are_shaped_inside_runtime_boundary') &&
    mainRs.includes('core_runtime::routing_group_rows(&groups') &&
    mainRs.includes('core_runtime::routing_group_counts(&group_rows)') &&
    !mainRs.includes('fn canonical_strategy_type') &&
    !mainRs.includes('let group_type = canonical_strategy_type(group_type_raw)'),
  'routing group type normalization, automatic classification, filtering, and counts must not be rebuilt in main.rs',
);
check(
  'Aegos routes proxy control APIs through typed CoreController methods',
  coreRuntimeRs.includes('fn proxies_payload(&self, timeout_ms: u64)') &&
    !coreRuntimeRs.includes('pub fn proxies_payload') &&
    coreRuntimeRs.includes('fn proxy_groups_snapshot(') &&
    !coreRuntimeRs.includes('pub fn proxy_groups_snapshot(') &&
    coreDomainRs.includes('pub struct ProxyNodeSnapshot') &&
    coreDomainRs.includes('pub struct ProxyGroupSnapshot') &&
    coreDomainRs.includes('pub fn proxy_groups_from_controller') &&
    coreRuntimeRs.includes('Result<Vec<ProxyGroupSnapshot>, String>') &&
    !coreRuntimeRs.includes('fn normalize_proxy_item') &&
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
    coreRuntimeRs.includes('pub fn proxy_catalog_snapshot(') &&
    dataplaneRs.includes('fn proxy_catalog_snapshot(&self, hidden_group_names: &[&str])') &&
    coreRuntimeRs.includes('impl DataplaneControl for CoreController') &&
    coreRuntimeRs.includes('core_controller_implements_dataplane_control_boundary') &&
    coreRuntimeRs.includes('pub const PROXY_GROUPS_SNAPSHOT_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub fn proxy_delay_with_client(') &&
    coreDomainRs.includes('pub struct DelayProbeSnapshot') &&
    coreDomainRs.includes('pub fn delay_probe_from_controller') &&
    coreRuntimeRs.includes('Result<DelayProbeSnapshot, CoreControllerHttpFailure>') &&
    coreRuntimeRs.includes('pub fn proxy_delay_result_with_client(') &&
    coreRuntimeRs.includes('pub fn classify_delay_http_failure(') &&
    mainRs.includes('.proxy_catalog_snapshot(&[AEGOS_OUTBOUND_IP_GROUP])') &&
    mainRs.includes('&[AEGOS_OUTBOUND_IP_GROUP]') &&
    mainRs.includes('controller: impl DataplaneControl') &&
    mainRs.includes('core.core_controller()') &&
    !mainRs.includes('fn assemble_proxy_groups_snapshot(\n    running: bool,\n    controller_port: u16') &&
    !mainRs.includes('fn assemble_proxy_groups_snapshot(\n    running: bool,\n    controller: core_runtime::CoreController,\n    secret:') &&
    !mainRs.includes('.ui_proxy_groups_snapshot_or_none(running, &[AEGOS_OUTBOUND_IP_GROUP])') &&
    !mainRs.includes('fn controller_proxy_groups_snapshot') &&
    !mainRs.includes('.ui_proxy_groups_snapshot(&[AEGOS_OUTBOUND_IP_GROUP])') &&
    !mainRs.includes('.proxy_groups_snapshot(1200, &[AEGOS_OUTBOUND_IP_GROUP])') &&
    !mainRs.includes('.proxies_snapshot(1200)') &&
    !mainRs.includes('fn normalize_proxy_item') &&
    mainRs.includes('fn test_proxy_delay_request(\n    client: &Client,\n    controller: &core_runtime::CoreController,') &&
    mainRs.includes('fn test_proxy_delay_plan(\n    client: &Client,\n    controller: &core_runtime::CoreController,') &&
    mainRs.includes('fn test_proxy_delay_with_retry(\n    client: &Client,\n    controller: &core_runtime::CoreController,') &&
    mainRs.includes('fn test_proxy_delay_fast(\n    client: &Client,\n    controller: &core_runtime::CoreController,') &&
    !mainRs.includes('fn test_proxy_delay_plan(\n    client: &Client,\n    controller_port: u16,') &&
    !mainRs.includes('fn test_proxy_delay_with_retry(\n    client: &Client,\n    controller_port: u16,') &&
    mainRs.includes('.proxy_delay_result_with_client(client, name, test_url, timeout_ms)') &&
    !mainRs.includes('fn classify_delay_http_failure') &&
    mainRs.includes('fn sync_outbound_ip_route(') &&
    mainRs.includes('.apply_auxiliary_proxy_selection(AEGOS_OUTBOUND_IP_GROUP, &proxy)') &&
    !speedTestBody.includes('apply_auxiliary_proxy_selection(') &&
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
  'Aegos owns node selection preflight and transactional rollback semantics',
  coreRuntimeRs.includes('pub struct ProxySelectionPreflight') &&
    coreRuntimeRs.includes('pub fn validate_proxy_selection_from_groups') &&
    coreRuntimeRs.includes('Node switch preflight failed') &&
    !mainRs.includes('fn validate_proxy_selection_from_groups') &&
    mainRs.includes('core_runtime::validate_proxy_selection_from_groups(&groups, group, proxy)?') &&
    mainRs.includes('previous runtime node rollback also failed:') &&
    mainRs.includes('Node preference save failed:') &&
    mainRs.indexOf('apply_proxy_selection_with_cleanup(group, proxy)') <
      mainRs.indexOf('.selected_proxy_map\n            .insert(group.to_string(), proxy.to_string())'),
  'node selection must apply, commit, and restore in a defined order',
);
check(
  'Aegos owns proxy-group snapshot shaping inside the core runtime boundary',
  coreRuntimeRs.includes('pub const AEGOS_AUTO_SELECT_GROUP_NAME') &&
  coreRuntimeRs.includes('pub fn is_proxies_group_name(') &&
  coreRuntimeRs.includes('pub fn is_aegos_auto_select_group_name(') &&
  coreDomainRs.includes('pub struct ProxyCatalog') &&
  coreDomainRs.includes('pub fn ensure_default_groups') &&
  coreDomainRs.includes('pub fn apply_selected_map') &&
  coreDomainRs.includes('pub fn annotate_manual_nodes') &&
  coreRuntimeRs.includes('pub fn shape_proxy_catalog_model(') &&
  coreRuntimeRs.includes('pub fn resolve_group_leaf(') &&
    coreRuntimeRs.includes('proxy_group_snapshot_defaults_are_shaped_inside_runtime_boundary') &&
    coreRuntimeRs.includes('proxy_group_resolution_and_manual_flags_are_runtime_shaped') &&
  mainRs.includes('core_runtime::shape_proxy_catalog_model(') &&
  mainRs.includes('core_runtime::resolve_group_leaf(') &&
    configPipelineRs.includes('core_runtime::is_proxies_group_name') &&
    configPipelineRs.includes('core_runtime::is_aegos_auto_select_group_name') &&
    configPipelineRs.includes('core_runtime::AEGOS_AUTO_SELECT_GROUP_NAME') &&
    configPipelineRs.includes('matching_indices.into_iter().skip(1).rev()') &&
    !mainRs.includes('fn normalize_proxy_groups_snapshot_defaults') &&
    !mainRs.includes('fn apply_group_resolution_with_selected_map') &&
    !mainRs.includes('fn annotate_manual_groups_with_names') &&
    !mainRs.includes('fn is_proxies_group_name') &&
    !mainRs.includes('fn is_aegos_auto_select_group_name') &&
    !mainRs.includes('fn snapshot_proxy_item_name') &&
    !mainRs.includes('fn all_real_snapshot_items') &&
    !mainRs.includes('fn group_selected_name') &&
  !mainRs.includes('fn resolve_group_leaf('),
  'proxy-group default rows, group references, manual flags, and group-name aliases must not be rebuilt in main.rs',
);
check(
  'Aegos routes readiness and mode control through typed CoreController methods',
  coreDomainRs.includes('pub struct RuntimeVersionSnapshot') &&
    coreDomainRs.includes('pub fn runtime_version_from_controller') &&
    coreRuntimeRs.includes('fn version_probe(&self, timeout_ms: u64) -> Result<RuntimeVersionSnapshot, String>') &&
    !coreRuntimeRs.includes('pub fn version_probe') &&
    coreRuntimeRs.includes('pub fn runtime_reuse_ready(&self) -> bool') &&
    coreRuntimeRs.includes('self.version_probe(READY_REUSE_PROBE_TIMEOUT_MS).is_ok()') &&
    coreRuntimeRs.includes('pub fn wait_until_ready') &&
    coreRuntimeRs.includes('pub fn process_exit_message') &&
    coreRuntimeRs.includes('pub const READY_REUSE_PROBE_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub const READY_PROBE_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub const READY_CHECK_ATTEMPTS') &&
    coreRuntimeRs.includes('pub const READY_RETRY_INTERVAL_MS') &&
    coreRuntimeRs.includes('pub const RUNTIME_RESTART_SETTLE_MS') &&
  coreRuntimeRs.includes('fn set_mode(&self, mode: &str, timeout_ms: u64) -> Result<(), String>') &&
    !coreRuntimeRs.includes('pub fn set_mode(&self') &&
    coreRuntimeRs.includes('pub fn apply_mode(&self, mode: &str) -> Result<(), String>') &&
    coreRuntimeRs.includes('pub fn apply_mode_if_running(') &&
    coreRuntimeRs.includes('Some(self.apply_mode(mode))') &&
    coreRuntimeRs.includes('pub const MODE_APPLY_TIMEOUT_MS') &&
    mainRs.includes('.wait_until_ready(||') &&
    mainRs.includes('.runtime_reuse_ready()') &&
    !mainRs.includes('core_runtime::READY_REUSE_PROBE_TIMEOUT_MS') &&
    mainRs.includes('core_runtime::RUNTIME_RESTART_SETTLE_MS') &&
    mainRs.includes('.apply_mode_if_running(self.process.is_some(), mode)') &&
    mainRs.includes('let previous_mode = self.settings.mode.clone();') &&
    mainRs.includes('Mode switch was not applied:') &&
    mainRs.includes('runtime rollback also failed:') &&
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
  'unclean core recovery stops only the exact managed executable before a fresh launch',
  coreRuntimeRs.includes('pub fn orphaned_core_cleanup_script') &&
    coreRuntimeRs.includes("Get-Process -Name {process_name_literal}") &&
    coreRuntimeRs.includes('$_.Path') &&
    coreRuntimeRs.includes('-ieq $expectedPath') &&
    coreRuntimeRs.includes('Stop-Process -Id $_.Id -Force') &&
    !coreRuntimeRs.includes('Get-CimInstance Win32_Process -Filter "Name = {binary_literal}"') &&
    coreRuntimeRs.includes('orphaned_core_cleanup_is_limited_to_the_managed_core_path') &&
    mainRs.includes('fn stop_orphaned_core_processes') &&
    mainRs.includes('run_powershell_with_timeout(&script, Duration::from_secs(3))') &&
    startWithTakeoverBody.includes('if self.process.is_none()') &&
    startWithTakeoverBody.includes('self.stop_orphaned_core_processes()') &&
    startWithTakeoverBody.indexOf('self.stop_orphaned_core_processes()') <
      startWithTakeoverBody.indexOf('self.ensure_runtime_ports()'),
  'stale Mihomo processes must be path scoped, CIM independent, timeout bounded, and cleared before port preparation',
);
check(
  'Aegos normalizes runtime profile YAML through the core runtime boundary',
  coreRuntimeRs.includes('pub struct CoreRuntimeProfile') &&
    coreRuntimeRs.includes('pub fn render_runtime_profile_yaml') &&
    coreRuntimeRs.includes('fn apply_interface_binding') &&
    storageRuntimeRs.includes('pub(crate) fn sha256_text') &&
    coreRuntimeRs.includes('use crate::storage_runtime::{atomic_write_text_confined, sha256_text};') &&
    mainRs.includes('core_runtime::render_runtime_profile_yaml') &&
    !mainRs.includes('fn apply_runtime_interface_binding_name') &&
    !mainRs.includes('serde_yaml::from_str(&rendered.yaml)'),
  'runtime YAML normalization, interface binding, and runtime digest must stay inside core_runtime',
);
check(
  'Aegos writes runtime profile files through the core runtime boundary',
  coreRuntimeRs.includes('pub struct CoreRuntimeProfileWrite') &&
    coreRuntimeRs.includes('pub fn write_runtime_profile') &&
    storageRuntimeRs.includes('pub(crate) fn atomic_write_text_confined') &&
    storageRuntimeRs.includes('pub(crate) fn ensure_path_within') &&
    storageRuntimeRs.includes('refusing to write outside managed root') &&
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
    coreRuntimeRs.includes('fn apply_runtime_config_path(&self, path: &Path) -> Result<(), String>') &&
    !coreRuntimeRs.includes('pub fn apply_runtime_config_path') &&
    coreRuntimeRs.includes('fn config_apply_version_probe(&self) -> Result<RuntimeVersionSnapshot, String>') &&
    !coreRuntimeRs.includes('pub fn config_apply_version_probe') &&
    coreRuntimeRs.includes('pub runtime_version: RuntimeVersionSnapshot') &&
    coreRuntimeRs.includes('pub fn receipt_json(&self) -> JsonValue') &&
    coreRuntimeRs.includes('runtime_apply_receipt_is_aegos_shaped') &&
    !coreRuntimeRs.includes('pub controller_response: JsonValue') &&
    !coreRuntimeRs.includes('pub version_probe: JsonValue') &&
    coreRuntimeRs.includes('controller.apply_runtime_config_path(&self.runtime_profile_path)') &&
    coreRuntimeRs.includes('controller.config_apply_version_probe()') &&
    !coreRuntimeRs.includes('controller.request("GET", "/version", None, 900)') &&
    !coreRuntimeRs.includes('Some(json!({ "path": self.runtime_profile_path.to_string_lossy().to_string() })),\n            8000') &&
    mainRs.includes('CoreRuntimeApplyTransaction::new') &&
    mainRs.includes('apply_transaction.apply(&self.core_controller())') &&
    hotReloadProfileBody.includes('let mut receipt = result.receipt_json();') &&
    hotReloadProfileBody.includes('"versionProbeCount".to_string(), json!(1)') &&
    hotReloadProfileBody.includes('json!("config-apply-version")') &&
    !hotReloadProfileBody.includes('self.wait_for_controller()?') &&
    mainRs.includes('let controller_ready = !was_running || reload.is_ok();') &&
    !mainRs.includes('let controller_ready = !was_running || self.core_controller().runtime_reuse_ready();') &&
    !mainRs.includes('"/configs?force=true"'),
  'runtime config apply uses one post-apply version probe without duplicate readiness round trips',
);
check(
  'runtime config unchanged result shaping is owned by the core runtime boundary',
  coreRuntimeRs.includes('pub fn runtime_config_unchanged_result_json') &&
    coreRuntimeRs.includes('runtime_config_unchanged_result_is_runtime_shaped') &&
    hotReloadProfileBody.includes('core_runtime::runtime_config_unchanged_result_json(') &&
    !hotReloadProfileBody.includes('"skipped": true') &&
    !hotReloadProfileBody.includes('"reason": "unchanged runtime config digest"') &&
    !hotReloadProfileBody.includes('"digest": config_digest'),
  'main.rs may detect unchanged config, but skipped/reason/digest result fields belong to core_runtime',
);
check(
  'Aegos owns core-facing failure classification inside the core runtime boundary',
  coreRuntimeRs.includes('pub fn classify_failure_reason') &&
    coreRuntimeRs.includes('pub fn classified_error') &&
    coreRuntimeRs.includes('runtime_failure_reason_classifier_covers_common_connection_failures') &&
    mainRs.includes('core_runtime::classified_error("Node switch", apply_error)') &&
    mainRs.includes('core_runtime::classify_failure_reason(&entry.line)') &&
    !mainRs.includes('fn classify_failure_reason') &&
    !mainRs.includes('fn classified_error'),
  'core/controller/node failure classes must not be rebuilt in main.rs',
);
check(
  'core startup failure message shaping is owned by the core runtime boundary',
  coreRuntimeRs.includes('pub struct CoreStartFailureContext') &&
    coreRuntimeRs.includes('pub fn message(&self, reason: &str) -> String') &&
    coreRuntimeRs.includes('profile: no active profile') &&
    coreRuntimeRs.includes('Core startup failed: {reason}') &&
    coreRuntimeRs.includes('runtime_lifecycle_messages_are_owned_by_runtime_boundary') &&
    mainRs.includes('CoreStartFailureContext::new') &&
    mainRs.includes('.message(reason)') &&
    !mainRs.includes('Core startup failed: {reason}; profile:') &&
    !mainRs.includes('unwrap_or("no active profile")'),
  'main.rs may collect runtime facts, but startup failure wording belongs to core_runtime',
);
check(
  'core runtime reuse and drift decisions are owned by the core runtime boundary',
  coreRuntimeRs.includes('pub enum CoreRuntimeStartAction') &&
    coreRuntimeRs.includes('pub fn runtime_identity_matches') &&
    coreRuntimeRs.includes('pub fn decide_runtime_start') &&
    coreRuntimeRs.includes('runtime_start_reuse_decision_is_owned_by_runtime_boundary') &&
    mainRs.includes('core_runtime::runtime_identity_matches') &&
    mainRs.includes('core_runtime::decide_runtime_start') &&
    mainRs.includes('CoreRuntimeStartAction::ReuseRunning') &&
    mainRs.includes('CoreRuntimeStartAction::RestartForDrift') &&
    !mainRs.includes('let same_profile =') &&
    !mainRs.includes('let same_config ='),
  'main.rs must not rebuild runtime identity/reuse/drift decisions',
);
check(
  'core restart takeover preservation is planned inside the core runtime boundary',
  coreRuntimeRs.includes('pub enum CoreRuntimeRestartAction') &&
    coreRuntimeRs.includes('pub struct CoreRuntimeRestartPlan') &&
    coreRuntimeRs.includes('pub fn for_runtime_drift') &&
    coreRuntimeRs.includes('pub fn preserving_proxy') &&
    coreRuntimeRs.includes('pub fn next_action(&self) -> CoreRuntimeRestartAction') &&
    coreRuntimeRs.includes('runtime_restart_plan_preserves_takeover_intent_inside_runtime_boundary') &&
    coreRuntimeRs.includes('standby_mutation.next_action()') &&
    mainRs.includes('CoreRuntimeRestartPlan::for_runtime_drift') &&
    mainRs.includes('CoreRuntimeRestartPlan::preserving_proxy') &&
    mainRs.includes('restart_plan.next_action()') &&
    mainRs.includes('CoreRuntimeRestartAction::StartWithTakeover') &&
    restartCorePreservingProxyBody.includes('self.start_from_restart_plan(restart_plan)') &&
    startFromRestartPlanBody.includes('restart_plan.should_restore_proxy_preference()') &&
    startFromRestartPlanBody.includes('restart_plan.next_action()') &&
    setActiveProfileBody.includes('let rollback_plan = core_runtime::CoreRuntimeRestartPlan::preserving_proxy(') &&
    setActiveProfileBody.includes('self.start_from_restart_plan(rollback_plan)') &&
    removeProfileBody.includes('let rollback_plan = core_runtime::CoreRuntimeRestartPlan::preserving_proxy(') &&
    removeProfileBody.includes('if let Err(err) = self.start_from_restart_plan(rollback_plan)') &&
    removeProfileBody.includes('self.settings = previous_settings') &&
    removeProfileBody.includes('let runtime_restore = self.start()') &&
    addProfileUrlDetachedBody.includes('core_runtime::CoreRuntimeRestartPlan::preserving_proxy(') &&
    addProfileUrlDetachedBody.includes('core.start_from_restart_plan(rollback_plan)') &&
    updateProfileDetachedBody.includes('core_runtime::CoreRuntimeRestartPlan::preserving_proxy(') &&
    updateProfileDetachedBody.includes('core.start_from_restart_plan(rollback_plan)') &&
    !setActiveProfileBody.includes('let restore_takeover =') &&
    !removeProfileBody.includes('let restore_takeover =') &&
    !addProfileUrlDetachedBody.includes('previous_system_proxy') &&
    !updateProfileDetachedBody.includes('previous_system_proxy'),
  'main.rs may execute stop/start, but restore-takeover restart intent and profile-mutation rollback planning belong to core_runtime',
);
check(
  'traffic takeover after core readiness is planned inside the core runtime boundary',
  coreRuntimeRs.includes('pub struct CoreTrafficTakeoverPlan') &&
    coreRuntimeRs.includes('pub fn after_core_ready') &&
    coreRuntimeRs.includes('pub fn optimistic_takeover_before_system_proxy') &&
    coreRuntimeRs.includes('pub fn final_traffic_takeover') &&
    coreRuntimeRs.includes('traffic_takeover_after_ready_is_owned_by_runtime_boundary') &&
    mainRs.includes('CoreTrafficTakeoverPlan::after_core_ready') &&
    mainRs.includes('takeover_plan.should_apply_system_proxy') &&
    mainRs.includes('takeover_plan.final_traffic_takeover(system_proxy_applied)') &&
    !mainRs.includes('let should_apply_system_proxy = self.settings.system_proxy'),
  'main.rs may execute set_system_proxy, but takeover policy belongs to core_runtime',
);
check(
  'system proxy snapshot policy is owned by the core runtime boundary',
    coreRuntimeRs.includes('pub struct SystemProxySnapshot') &&
    coreRuntimeRs.includes('pub fn system_proxy_snapshot_points_to_aegos') &&
    coreRuntimeRs.includes('pub fn should_capture_system_proxy_snapshot') &&
    coreRuntimeRs.includes('pub fn verify_system_proxy_snapshot') &&
    coreRuntimeRs.includes('system_proxy_snapshot_policy_is_owned_by_runtime_boundary') &&
    coreRuntimeRs.includes('system_proxy_verification_is_owned_by_runtime_boundary') &&
    mainRs.includes('core_runtime::SystemProxySnapshot') &&
    mainRs.includes('core_runtime::system_proxy_snapshot_points_to_aegos') &&
    mainRs.includes('core_runtime::should_capture_system_proxy_snapshot') &&
    mainRs.includes('core_runtime::verify_system_proxy_snapshot') &&
    !mainRs.includes('struct SystemProxySnapshot') &&
    !mainRs.includes('fn proxy_points_to_aegos') &&
    !mainRs.includes('Windows system proxy verification failed: current') &&
    !mainRs.includes('Windows system proxy restore verification failed'),
  'main.rs may read/write Windows proxy state, but snapshot shape and matching policy belong to core_runtime',
);
check(
  'system proxy repair result shaping is owned by the core runtime boundary',
  coreRuntimeRs.includes('pub fn system_proxy_repair_result_json') &&
    coreRuntimeRs.includes('system_proxy_repair_result_is_runtime_shaped') &&
    repairSystemProxyTakeoverBody.includes('core_runtime::system_proxy_repair_result_json(') &&
    !repairSystemProxyTakeoverBody.includes('"endpoint": format!("127.0.0.1:{}"') &&
    !repairSystemProxyTakeoverBody.includes('"current": current'),
  'main.rs may verify Windows proxy repair, but endpoint/current result fields belong to core_runtime',
);
check(
  'protection status shaping is owned by the core runtime boundary',
  coreRuntimeRs.includes('pub fn protection_phase') &&
    coreRuntimeRs.includes('pub fn protection_status_json') &&
    coreRuntimeRs.includes('protection_status_is_runtime_shaped_without_mojibake_labels') &&
    coreRuntimeRs.includes('"Disconnect protected"') &&
    coreRuntimeRs.includes('"TUN tunnel"') &&
    coreRuntimeRs.includes('"System proxy"') &&
    mainRs.includes('core_runtime::protection_status_json(') &&
    !mainRs.includes('let level = if !running') &&
    !mainRs.includes('let level = if !snapshot.running') &&
    !mainRs.includes('"閺傤厾缍夋穱婵囧Б"') &&
    !mainRs.includes('"閸忋劌鐪') &&
    !mainRs.includes('"缁崵绮'),
  'home and diagnostics protection state must use one runtime-owned model without mojibake labels',
);
check(
  'home and diagnostics status surfaces are owned by the core runtime boundary',
  coreRuntimeRs.includes('pub fn status_surface_json') &&
    coreRuntimeRs.includes('status_surface_json_is_runtime_shaped_without_mojibake_permissions') &&
    (mainRs.match(/core_runtime::status_surface_json\(/g) || []).length === 2 &&
    !mainRs.includes('"product": "Aegos"') &&
    !mainRs.includes('"proxyEndpoint": format!("127.0.0.1:{}"') &&
    !mainRs.includes('"requiresAdminFor": ["TUN"'),
  'home and diagnostics must not rebuild the shared runtime status surface or mojibake permission labels',
);
check(
  'proxy takeover public status is owned by the core runtime boundary',
  coreRuntimeRs.includes('pub fn proxy_takeover_status_json') &&
    coreRuntimeRs.includes('proxy_takeover_status_is_runtime_shaped') &&
    coreRuntimeRs.includes('public_settings_surface_json') &&
    !mainRs.includes('core_runtime::proxy_takeover_status_json(') &&
    !(mainRs.match(/"proxyTakeover":\s*json!\s*\(\s*\{/g) || []).length &&
    !mainRs.includes('"active": self.traffic_takeover') &&
    !mainRs.includes('"active": snapshot.traffic_takeover'),
  'home and diagnostics proxy takeover status must not rebuild runtime endpoint/active/standby state',
);
check(
  'public settings surfaces are owned by the core runtime boundary',
  coreRuntimeRs.includes('pub fn public_settings_surface_json') &&
    coreRuntimeRs.includes('public_settings_surface_json_is_runtime_shaped') &&
    (mainRs.match(/core_runtime::public_settings_surface_json\(/g) || []).length === 2 &&
    coreRuntimeRs.includes('pub const RESERVED_MIXED_PORTS') &&
    coreRuntimeRs.includes('pub const RESERVED_MIXED_PORTS_REASON') &&
    !mainRs.includes('"reservedPorts":') &&
    !mainRs.includes('"runtimes": { "mihomo"') &&
    !mainRs.includes('"reliability": {'),
  'home and diagnostics settings must not rebuild runtime ports, runtime presence, reliability, or proxy takeover fields',
);
check(
  'runtime port parsing and pair validation are owned by the core runtime boundary',
  coreRuntimeRs.includes('pub fn port_from_value') &&
    coreRuntimeRs.includes('pub fn mixed_port_from_value') &&
    coreRuntimeRs.includes('pub fn validate_runtime_ports') &&
    coreRuntimeRs.includes('runtime_port_policy_is_owned_by_runtime_boundary') &&
    mainRs.includes('core_runtime::mixed_port_from_value') &&
    mainRs.includes('core_runtime::port_from_value') &&
    mainRs.includes('core_runtime::validate_runtime_ports(settings.mixed_port, settings.controller_port)') &&
    !mainRs.includes('settings.mixed_port == settings.controller_port') &&
    !mainRs.includes('RESERVED_MIXED_PORTS.contains(&settings.mixed_port)'),
  'main.rs may apply settings, but runtime port bounds, reserved ports, and pair validation belong to core_runtime',
);
check(
  'diagnostic check and summary shaping are owned by the core runtime boundary',
  coreRuntimeRs.includes('pub fn diagnostic_check_json') &&
    coreRuntimeRs.includes('pub fn diagnostic_summary_json') &&
    coreRuntimeRs.includes('diagnostic_check_and_summary_are_runtime_shaped') &&
    mainRs.includes('core_runtime::diagnostic_check_json(') &&
    mainRs.includes('core_runtime::diagnostic_summary_json(&checks)') &&
    !mainRs.includes('let check =') &&
    !mainRs.includes('let failed_count = checks') &&
    !mainRs.includes('let next_actions = checks') &&
    !mainRs.includes('閺傤厾缍夋穱婵囧Б'),
  'main.rs may collect diagnostic facts, but check row shape, summary counts, next actions, and permission labels belong to core_runtime',
);
check(
  'core power command result shaping is owned by the core runtime boundary',
  coreRuntimeRs.includes('pub fn core_start_result_json') &&
    coreRuntimeRs.includes('pub fn core_stop_result_json') &&
    coreRuntimeRs.includes('core_power_results_are_runtime_shaped') &&
    (startWithTakeoverBody.match(/core_runtime::core_start_result_json\(/g) || []).length === 2 &&
    stopBody.includes('core_runtime::core_stop_result_json()') &&
    !startWithTakeoverBody.includes('"message": "Core already running"') &&
    !startWithTakeoverBody.includes('"standby": !enable_takeover') &&
    !startWithTakeoverBody.includes('"connection": self.connection_closure()') &&
    !stopBody.includes('Ok(json!({ "ok": true }))'),
  'main.rs may execute start/stop, but the public core power result contract belongs to core_runtime',
);
check(
  'recovery probe and result shaping are owned by the core runtime boundary',
  coreRuntimeRs.includes('pub fn recovery_probe_result_json') &&
    coreRuntimeRs.includes('pub fn recovery_switch_proxy_result_json') &&
    coreRuntimeRs.includes('pub fn recovery_healthy_result_json') &&
    coreRuntimeRs.includes('pub fn recovery_observe_result_json') &&
    coreRuntimeRs.includes('pub fn recovery_proxy_switched_result_json') &&
    coreRuntimeRs.includes('pub fn recovery_profile_switched_result_json') &&
    coreRuntimeRs.includes('pub fn recovery_failed_result_json') &&
    coreRuntimeRs.includes('recovery_results_are_runtime_shaped') &&
    probeProxyNetworkBody.includes('core_runtime::recovery_probe_result_json(') &&
    tryRecoverCurrentProfileBody.includes('core_runtime::recovery_switch_proxy_result_json(') &&
    recoverNetworkBody.includes('core_runtime::recovery_healthy_result_json(') &&
    recoverNetworkBody.includes('core_runtime::recovery_observe_result_json(') &&
    recoverNetworkBody.includes('core_runtime::recovery_proxy_switched_result_json(') &&
    recoverNetworkBody.includes('core_runtime::recovery_profile_switched_result_json(') &&
    recoverNetworkBody.includes('core_runtime::recovery_failed_result_json(') &&
    !probeProxyNetworkBody.includes('"status": 0') &&
    !tryRecoverCurrentProfileBody.includes('"action": "switchProxy"') &&
    !recoverNetworkBody.includes('"action": "observe"') &&
    !recoverNetworkBody.includes('"action": "failed"') &&
    !recoverNetworkBody.includes('"profileChanged":'),
  'main.rs may execute recovery, but probe/result fields, actions, and profileChanged semantics belong to core_runtime',
);
check(
  'recovery candidate planning is owned by the core runtime boundary',
  coreRuntimeRs.includes('pub struct RecoveryCandidatePlan') &&
    coreRuntimeRs.includes('pub fn recovery_candidate_plan') &&
    coreRuntimeRs.includes('pub fn recovery_group_rank') &&
    coreRuntimeRs.includes('pub fn is_recovery_candidate_proxy_name') &&
    coreRuntimeRs.includes('fn is_recovery_group_reference_item') &&
    coreRuntimeRs.includes('recovery_candidate_plan_filters_and_orders_runtime_candidates') &&
    recoveryCandidatesBody.includes('core_runtime::recovery_candidate_plan(') &&
    recoveryCandidatesBody.includes('test_proxy_delay_with_retry(') &&
    !mainRs.includes('fn recovery_group_rank') &&
    !mainRs.includes('fn is_recovery_candidate_name') &&
    !recoveryCandidatesBody.includes('sort_by_key(|group|') &&
    !recoveryCandidatesBody.includes('"GLOBAL"') &&
    !recoveryCandidatesBody.includes('"Proxy"') &&
    !recoveryCandidatesBody.includes('"Proxies"') &&
    !recoveryCandidatesBody.includes('HashSet::new()'),
  'main.rs may probe planned recovery candidates, but group rank, filtering, dedupe, and candidate limits belong to core_runtime',
);
check(
  'recovery profile failover planning is owned by the core runtime boundary',
  coreRuntimeRs.includes('pub struct RecoveryProfileFailoverPlan') &&
    coreRuntimeRs.includes('pub fn recovery_profile_failover_plan') &&
    coreRuntimeRs.includes('recovery_profile_failover_plan_filters_runtime_candidates') &&
    recoverNetworkBody.includes('core_runtime::recovery_profile_failover_plan(') &&
    recoverNetworkBody.includes('self.set_active_profile(&candidate.id)') &&
    !recoverNetworkBody.includes('.filter(|profile|') &&
    !recoverNetworkBody.includes('profile.profile_type != "builtin"') &&
    !recoverNetworkBody.includes('profile.id != "direct"'),
  'main.rs may execute profile switching, but failover candidate filtering and ordering belong to core_runtime',
);
check(
  'system proxy takeover plan is owned by the core runtime boundary',
    coreRuntimeRs.includes('pub const WINDOWS_PROXY_BYPASS_LIST') &&
    coreRuntimeRs.includes('pub struct CoreSystemProxyTakeoverPlan') &&
    coreRuntimeRs.includes('pub struct WindowsSystemProxyScriptPlan') &&
    coreRuntimeRs.includes('pub fn windows_proxy_server') &&
    coreRuntimeRs.includes('pub fn windows_proxy_snapshot_script_plan') &&
    coreRuntimeRs.includes('pub fn windows_proxy_takeover_script_plan') &&
    coreRuntimeRs.includes('pub fn new(enable: bool, mixed_port: u16)') &&
    coreRuntimeRs.includes('pub fn should_write_proxy_server') &&
    coreRuntimeRs.includes('system_proxy_takeover_plan_is_owned_by_runtime_boundary') &&
    mainRs.includes('core_runtime::windows_proxy_snapshot_script_plan') &&
    mainRs.includes('core_runtime::windows_proxy_takeover_script_plan') &&
    mainRs.includes('plan.proxy_enable_value') &&
    mainRs.includes('plan.should_write_proxy_server()') &&
    mainRs.includes('plan.proxy_server_literal.as_deref()') &&
    mainRs.includes('plan.proxy_override_literal') &&
    !mainRs.includes('CoreSystemProxyTakeoverPlan::new') &&
    !mainRs.includes('let server = ps_escape(&snapshot.proxy_server)') &&
    !mainRs.includes("Value '{server}'") &&
    !mainRs.includes("Value '{proxy_override}'") &&
    !mainRs.includes('format!("127.0.0.1:{mixed_port}")') &&
    !mainRs.includes('<local>;localhost;127.*;10.*;172.16.*'),
  'main.rs may write Windows registry values, but proxy server/bypass policy and script input literals belong to core_runtime',
);
check(
  'disconnect protection firewall policy is owned by the core runtime boundary',
  coreRuntimeRs.includes('pub const FIREWALL_DISCONNECT_PROTECTION_GROUP') &&
    coreRuntimeRs.includes('pub const FIREWALL_SPEED_TEST_GROUP') &&
    coreRuntimeRs.includes('pub const FIREWALL_PROFILE_SNAPSHOT_FILE') &&
    coreRuntimeRs.includes('pub const FIREWALL_SPEED_TEST_MARKER_FILE') &&
    coreRuntimeRs.includes('pub struct CoreFirewallPolicyPlan') &&
    coreRuntimeRs.includes('pub fn disconnect_protection()') &&
    coreRuntimeRs.includes('pub fn speed_test()') &&
    coreRuntimeRs.includes('pub fn powershell_single_quote_escape') &&
    coreRuntimeRs.includes('pub fn powershell_string_array_literal') &&
    coreRuntimeRs.includes('pub fn normalize_windows_program_path_text') &&
    coreRuntimeRs.includes('pub fn firewall_program_path') &&
    coreRuntimeRs.includes('pub fn firewall_program_paths') &&
    coreRuntimeRs.includes('firewall_policy_contract_is_owned_by_runtime_boundary') &&
    mainRs.includes('CoreFirewallPolicyPlan::disconnect_protection') &&
    mainRs.includes('CoreFirewallPolicyPlan::speed_test') &&
    mainRs.includes('core_runtime::firewall_program_paths') &&
    mainRs.includes('core_runtime::powershell_string_array_literal') &&
    !mainRs.includes('format!("{APP_NAME} Kill Switch') &&
    !mainRs.includes('kill-switch-firewall-profile.json') &&
    !mainRs.includes('kill-switch-speed-test-rules.marker') &&
    !mainRs.includes('fn ps_escape') &&
    !mainRs.includes('fn firewall_program_path') &&
    !mainRs.includes('fn build_speed_test_firewall_script') &&
    !mainRs.includes('remoteport=$portList') &&
    !mainRs.includes('fn ps_array_literal') &&
    !mainRs.includes('fn ps_port_list'),
  'main.rs may execute firewall scripts, but group names, state files, program path shaping, and speed-test firewall policy belong to core_runtime',
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
