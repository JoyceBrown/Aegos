import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
const coreRuntimeRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'core_runtime.rs'), 'utf8');
const profileCompilerRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'profile_compiler.rs'), 'utf8');
const configPipelineRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'config_pipeline.rs'), 'utf8');

const fail = [];
const pass = [];

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

const statusBody = mainRs.match(/fn status\(&mut self\) -> JsonValue \{([\s\S]*?)\n    \}/)?.[1] || '';
const commandSection = mainRs.slice(mainRs.indexOf('#[tauri::command]'));
const speedStart = mainRs.indexOf('fn start_proxy_delay_test');
const speedEnd = mainRs.indexOf('fn test_single_proxy_delay', speedStart);
const speedTestBody = speedStart >= 0 && speedEnd > speedStart ? mainRs.slice(speedStart, speedEnd) : '';
const speedCommandBody = mainRs.match(/fn start_proxy_delay_test\(state: State<AppState>\) -> Result<JsonValue, String> \{([\s\S]*?)\n\}/)?.[1] || '';
const singleSpeedCommandBody = mainRs.match(/fn test_single_proxy_delay\(state: State<AppState>, name: String\) -> Result<JsonValue, String> \{([\s\S]*?)\n\}/)?.[1] || '';
const activeConnectionCommandBody = mainRs.match(/fn active_connection_count\(state: State<AppState>\) -> Result<JsonValue, String> \{([\s\S]*?)\n\}/)?.[1] || '';

function hasControllerCall(method, timeout) {
  return new RegExp(`controller\\s*\\.\\s*${method}\\(\\s*${timeout}\\s*\\)`).test(mainRs);
}

function hasControllerCallWithArg(method, arg, timeout) {
  return new RegExp(`controller\\s*\\.\\s*${method}\\(\\s*${arg}\\s*,\\s*${timeout}\\s*\\)`).test(mainRs);
}

check(
  'status snapshot avoids controller version probe',
  !statusBody.includes('"/version"') &&
    statusBody.includes('core_runtime::runtime_status_json') &&
    coreRuntimeRs.includes('pub fn runtime_status_json(') &&
    coreRuntimeRs.includes('"version": JsonValue::Null') &&
    !statusBody.includes('"version": JsonValue::Null'),
  'app_status should stay lightweight'
);
check(
  'status traffic timeout stays short',
  statusBody.includes('traffic_snapshot()') &&
    coreRuntimeRs.includes('pub fn status_traffic_snapshot(&self)') &&
    coreRuntimeRs.includes('pub const STATUS_TRAFFIC_TIMEOUT_MS') &&
    !statusBody.includes('traffic_snapshot(120)') &&
    !statusBody.includes('traffic_snapshot(450)'),
  'traffic snapshot timeout'
);
check(
  'speed tests run in background thread',
  mainRs.includes('fn start_proxy_delay_test') && mainRs.includes('thread::spawn(move ||') && mainRs.includes('speed_test_snapshot'),
  'background delay test'
);
check(
  'batch speed-test command returns before slow core preparation',
  speedCommandBody.includes('mark_speed_test_preparing(&state.speed_test)') &&
    speedCommandBody.includes('thread::spawn(move ||') &&
    speedCommandBody.includes('start_proxy_delay_test_for_run(Some(run_id))') &&
    !speedCommandBody.includes('state.core.lock().unwrap().start_proxy_delay_test()'),
  'clicking speed test should not wait for standby core preparation or proxy-group assembly'
);
check(
  'single-node speed-test command returns before slow core preparation',
  singleSpeedCommandBody.includes('mark_single_speed_test_preparing(&state.speed_test, &name)') &&
    singleSpeedCommandBody.includes('thread::spawn(move ||') &&
    singleSpeedCommandBody.includes('test_single_proxy_delay_for_run(name, Some(run_id))') &&
    !singleSpeedCommandBody.includes('state.core.lock().unwrap().test_single_proxy_delay(name)'),
  'single-node speed buttons should not wait for standby core preparation or proxy-group assembly'
);
check(
  'speed tests use standby core without traffic takeover or proxy switching',
  mainRs.includes('fn start_standby') &&
    mainRs.includes('fn ensure_core_for_delay_test') &&
    speedTestBody.includes('ensure_core_for_delay_test') &&
    mainRs.includes('core_runtime::STANDBY_SPEED_START_MESSAGE') &&
    coreRuntimeRs.includes('pub const STANDBY_SPEED_START_MESSAGE') &&
    coreRuntimeRs.includes('Speed test starting mihomo in standby without traffic takeover') &&
    mainRs.includes('settings.tun_enabled = false') &&
    mainRs.includes('"trafficTakeover"') &&
    !speedTestBody.includes('change_proxy') &&
    !speedTestBody.includes('select_best_proxy'),
  'delay test may prepare a standby controller but remains measurement-only'
);
check(
  'disconnect protection allows speed tests without disabling protection',
  mainRs.includes('fn build_speed_test_firewall_script') &&
    mainRs.includes('fn speed_test_firewall_ports') &&
    mainRs.includes('"name=$rulePrefix DNS UDP"') &&
    mainRs.includes('"name=$rulePrefix DNS TCP"') &&
    mainRs.includes('remoteport=$portList') &&
    mainRs.includes('cleanup_speed_firewall') &&
    /thread::spawn\(move \|\| \{[\s\S]*build_speed_test_firewall_script\(\s*true/.test(mainRs) &&
    !/fn ensure_core_for_delay_test[\s\S]*refresh_kill_switch_rules_if_enabled\("speed test"\)/.test(mainRs),
  'speed-test preparation opens a temporary node-port firewall window inside the background worker'
);
check(
  'TUIC delay path has lower concurrency',
  mainRs.includes('fn protocol_concurrency') &&
    mainRs.includes('"tuic" => 8') &&
    mainRs.includes('speed_test_phases') &&
    mainRs.includes('protocol_primary_timeout_ms'),
  'protocol-aware concurrency'
);
check(
  'modern URI airport protocols are parsed',
  mainRs.includes('fn parse_vless_uri') &&
    mainRs.includes('fn parse_hysteria2_uri') &&
    mainRs.includes('fn parse_anytls_uri') &&
    mainRs.includes('line.starts_with("vless://")') &&
    mainRs.includes('line.starts_with("hysteria2://")') &&
    mainRs.includes('line.starts_with("hy2://")') &&
    mainRs.includes('line.starts_with("anytls://")') &&
    mainRs.includes('parses_modern_uri_subscription_protocols'),
  'VLESS, Hysteria2/Hy2, and AnyTLS URI subscriptions'
);
check(
  'runtime DNS is isolated from local fake-ip resolvers',
  configPipelineRs.includes('pub(crate) const AEGOS_DNS_LISTEN: &str = "127.0.0.1:1054"') &&
    configPipelineRs.includes('const AEGOS_DIRECT_NAMESERVERS') &&
    configPipelineRs.includes('https://223.5.5.5/dns-query') &&
    configPipelineRs.includes('https://1.1.1.1/dns-query') &&
    configPipelineRs.includes('pub(crate) fn harden_runtime_dns') &&
    configPipelineRs.includes('proxy-server-nameserver') &&
    configPipelineRs.includes('pub(crate) fn is_local_or_fake_nameserver') &&
    mainRs.includes('config_pipeline::harden_runtime_dns(&mut config)') &&
    mainRs.includes('runtime_dns_is_isolated_from_local_fake_ip_resolvers'),
  'proxy server domains must not resolve through 127.0.0.1:1053 or 198.18/198.19 fake-ip DNS'
);
check(
  'runtime outbound interface avoids nested virtual adapter routing',
  mainRs.includes('fn detect_windows_primary_interface_name') &&
    coreRuntimeRs.includes('fn apply_interface_binding') &&
    coreRuntimeRs.includes('"interface-name"') &&
    mainRs.includes('core_runtime::render_runtime_profile_yaml') &&
    mainRs.includes('flclash|clash|mihomo|aegos|tun|tap|wintun') &&
    mainRs.includes('Get-NetRoute -DestinationPrefix') &&
    mainRs.includes('Get-NetAdapter -InterfaceIndex') &&
    mainRs.includes('outbound interface') &&
    coreRuntimeRs.includes('runtime_interface_binding_sets_mihomo_interface_name') &&
    !mainRs.includes('fn apply_runtime_interface_binding_name'),
  'Aegos mihomo outbound must bind to a real adapter instead of nesting into FlClash/Wintun/TUN routes'
);
check(
  'airport metadata pseudo nodes are removed before runtime and speed tests',
  mainRs.includes('fn is_subscription_metadata_node_name') &&
    mainRs.includes('fn sanitize_subscription_metadata_nodes') &&
    mainRs.includes('subscription_metadata_nodes_are_removed_before_runtime_and_speed') &&
    mainRs.includes('is_subscription_metadata_node_name(name)') &&
    mainRs.includes('is_fake_ip_address(server)'),
  'Traffic/Expire plan rows must not become selectable or speed-tested nodes'
);
check(
  'long operations expose background job API',
  ['start_job', 'job_status', 'cancel_job'].every((name) => commandSection.includes(`fn ${name}`)) &&
    ['addProfileUrl', 'updateProfile', 'setActiveProfile', 'updateSetting', 'updateSettings', 'setMode', 'changeProxy', 'recoverNetwork', 'refreshOutboundIp', 'diagnostics', 'startCore', 'stopCore', 'restartCore'].every((name) => mainRs.includes(name)),
  'background jobs for core power, settings, mode/proxy, subscription, recovery, diagnostics, and outbound IP'
);

check(
  'subscription and outbound IP jobs reduce core lock scope',
    mainRs.includes('add_profile_url_detached') &&
    mainRs.includes('update_profile_detached') &&
    mainRs.includes('refresh_outbound_ip_detached') &&
    mainRs.includes('download_profile_source_url_diagnostic(url)?') &&
    mainRs.includes('query_outbound_ip(mixed_port)') &&
    mainRs.includes('normalize_outbound_ip_response') &&
    mainRs.includes('checkip.amazonaws.com') &&
    mainRs.includes('keeping cached value'),
  'network waits happen outside the CoreManager mutex; outbound IP uses validated multi-provider fallback'
);

check(
  'smart-mode outbound IP lookup uses an internal current-node group',
  mainRs.includes('OUTBOUND_IP_RULE_DOMAINS') &&
    mainRs.includes('AEGOS_OUTBOUND_IP_GROUP') &&
    mainRs.includes('fn upsert_outbound_ip_group') &&
    mainRs.includes('fn sync_outbound_ip_group_selection') &&
    mainRs.includes('fn insert_outbound_ip_rules') &&
    mainRs.includes('DOMAIN,{domain},{target}') &&
    mainRs.includes('outbound_ip_lookup_rules_use_internal_current_node_group'),
  'internal IP lookup domains are routed through a hidden group synced to the current node'
);

check(
  'core startup failures include actionable diagnostics',
  mainRs.includes('fn start_failure_message') &&
    mainRs.includes('recent_log_summary') &&
    mainRs.includes('Core startup failed: {reason}') &&
    mainRs.includes('Config generation failed: {err}') &&
    mainRs.includes('Core process spawn failed: {err}') &&
    mainRs.includes('self.wait_for_controller()?') &&
    coreRuntimeRs.includes('pub fn wait_until_ready') &&
    mainRs.includes('core_runtime::TERMINATE_FAILED_STARTUP_MESSAGE') &&
    coreRuntimeRs.includes('pub const CONTROLLER_READY_TIMEOUT_MESSAGE') &&
    coreRuntimeRs.includes('pub const TERMINATE_FAILED_STARTUP_MESSAGE') &&
    coreRuntimeRs.includes('runtime_lifecycle_messages_are_owned_by_runtime_boundary'),
  'startup failure context'
);

check(
  'diagnostics include active profile and recent core logs',
  mainRs.includes('"Active profile config"') &&
    mainRs.includes('"Profile preflight"') &&
    mainRs.includes('"Recent core logs"') &&
    mainRs.includes('recent_logs(8)') &&
    mainRs.includes('preflight_runtime_config'),
  'diagnostic checks'
);

check(
  'diagnostics include severity summary and actionable hints',
  mainRs.includes('"severity"') &&
    mainRs.includes('"hint"') &&
    mainRs.includes('"actionable"') &&
    mainRs.includes('"summary"') &&
    mainRs.includes('"nextActions"') &&
    mainRs.includes('let admin_required = snapshot.settings.tun_enabled || snapshot.settings.kill_switch_enabled') &&
    mainRs.includes('let admin_ok = is_admin || !admin_required'),
  'diagnostic metadata'
);

check(
  'system proxy takeover snapshots and restores previous Windows proxy',
  mainRs.includes('struct SystemProxySnapshot') &&
    mainRs.includes('fn read_windows_proxy_snapshot') &&
    mainRs.includes('fn write_windows_proxy_snapshot') &&
    mainRs.includes('fn capture_proxy_snapshot_before_takeover') &&
    mainRs.includes('fn shutdown_for_exit') &&
    mainRs.includes('repair_system_proxy_takeover') &&
    mainRs.includes('"Windows System Proxy takeover"'),
  'proxy snapshot/restore'
);

check(
  'manual system proxy preference does not auto-connect traffic takeover',
  mainRs.includes('System proxy preference enabled; connect before applying Windows proxy takeover') &&
    mainRs.includes('if enable && !self.traffic_takeover') &&
    /self\.traffic_takeover\s*=\s*self\.process\.is_some\(\)\s*&&/.test(mainRs),
  'system proxy can be saved as preference before connection'
);

check(
  'TUN-off connect applies system proxy takeover',
  mainRs.includes('fn apply_takeover_after_core_ready') &&
    mainRs.includes('|| !self.settings.tun_enabled') &&
    mainRs.includes('self.settings.system_proxy = true;') &&
    mainRs.includes('self.set_system_proxy(true)'),
  'connect should still take over traffic through Windows system proxy when TUN is off'
);

check(
  'active connection count uses short controller query',
  coreRuntimeRs.includes('pub fn active_connection_count(&self, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn active_connection_count_snapshot_or_idle(') &&
    coreRuntimeRs.includes('pub fn connections_snapshot(&self, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn connections_snapshot_or_empty(&self, running: bool, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn recent_rule_hits_snapshot(') &&
    coreRuntimeRs.includes('pub fn routing_recent_rule_hits_snapshot_or_empty(&self, running: bool)') &&
    coreRuntimeRs.includes('pub fn recent_rule_hits_from_connections(') &&
    mainRs.includes('fn active_connection_count(state: State<AppState>)') &&
    mainRs.includes('active_connection_count,') &&
    mainRs.includes('controller.home_active_connection_count_snapshot_or_idle(running)') &&
    mainRs.includes('controller.ui_connections_snapshot_or_empty(running)') &&
    mainRs.includes('.routing_recent_rule_hits_snapshot_or_empty(running)') &&
    coreRuntimeRs.includes('pub fn home_active_connection_count_snapshot_or_idle(&self, running: bool)') &&
    coreRuntimeRs.includes('pub fn ui_connections_snapshot_or_empty(&self, running: bool)') &&
    coreRuntimeRs.includes('pub const ROUTING_RECENT_RULES_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub const ROUTING_RECENT_RULES_LIMIT') &&
    coreRuntimeRs.includes('pub const ACTIVE_CONNECTION_COUNT_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub const CONNECTIONS_SNAPSHOT_TIMEOUT_MS') &&
    !activeConnectionCommandBody.includes('now_secs') &&
    !mainRs.includes('fn active_connection_count(&self) -> JsonValue'),
  'home active connection metric should stay lightweight and avoid holding the core lock during HTTP'
);

check(
  'volatile status commands avoid the CoreManager mutex during slow work',
  mainRs.includes('speed_test: Arc<Mutex<SpeedTestState>>') &&
    mainRs.includes('logs: Arc<Mutex<Vec<LogEntry>>>') &&
    mainRs.includes('app_data: PathBuf') &&
    mainRs.includes('fn speed_test_snapshot_from_state') &&
    mainRs.includes('fn export_logs_from_state') &&
    mainRs.includes('fn speed_test_status(state: State<AppState>)') &&
    mainRs.includes('speed_test_snapshot_from_state(&state.speed_test)') &&
    mainRs.includes('export_logs_from_state(&state.logs, &state.app_data)') &&
    mainRs.includes('state.logs.lock().unwrap().clear()') &&
    mainRs.includes('controller.ui_connections_snapshot_or_empty(running)') &&
    mainRs.includes('controller.close_connection_for_ui(&id)') &&
    mainRs.includes('controller.close_all_connections_for_ui()') &&
    coreRuntimeRs.includes('pub fn close_connection_for_ui(&self, id: &str)') &&
    coreRuntimeRs.includes('pub fn close_all_connections_for_ui(&self)') &&
    coreRuntimeRs.includes('pub const CLOSE_CONNECTION_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub const CLOSE_ALL_CONNECTIONS_TIMEOUT_MS') &&
    !mainRs.includes('fn export_logs(&self) -> Result<JsonValue, String>') &&
    !mainRs.includes('fn connections(&self) -> JsonValue') &&
    !mainRs.includes('fn close_connections(&self) -> Result<bool, String>'),
  'speed polling, logs, and connection controls should not queue behind unrelated core operations'
);

check(
  'proxy group refresh and preview avoid holding the CoreManager mutex during controller/YAML work',
  mainRs.includes('fn assemble_proxy_groups_snapshot') &&
    coreRuntimeRs.includes('pub fn ui_proxy_groups_snapshot_or_none(') &&
    mainRs.includes('fn profile_proxy_groups_for_profile_snapshot') &&
    mainRs.includes('fn apply_group_resolution_with_selected_map') &&
    mainRs.includes('fn apply_speed_test_delays_from_state') &&
    mainRs.includes('fn proxy_groups(state: State<AppState>)') &&
    mainRs.includes('assemble_proxy_groups_snapshot(') &&
    mainRs.includes('fn preview_profile_groups(state: State<AppState>, id: String)') &&
    mainRs.includes('profile_proxy_groups_for_profile_snapshot(') &&
    !mainRs.includes('state.core.lock().unwrap().proxy_groups()') &&
    !mainRs.includes('state.core.lock().unwrap().preview_profile_groups(&id)'),
  'node list refresh and subscription preview should snapshot core state, then do controller/file parsing outside the core lock'
);

check(
  'proxy controller APIs are typed and keep speed tests measurement-only',
  coreRuntimeRs.includes('pub fn proxies_snapshot(&self, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn proxy_groups_snapshot(') &&
    coreRuntimeRs.includes('fn normalize_proxy_item') &&
    coreRuntimeRs.includes('pub fn select_proxy(&self, group: &str, proxy: &str, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn apply_proxy_selection(&self, group: &str, proxy: &str)') &&
    coreRuntimeRs.includes('pub fn apply_auxiliary_proxy_selection(&self, group: &str, proxy: &str)') &&
    coreRuntimeRs.includes('pub fn cleanup_stale_connections_after_selection(&self)') &&
    coreRuntimeRs.includes('pub const PROXY_SELECT_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub const AUXILIARY_PROXY_SELECT_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub const STALE_CONNECTION_CLEANUP_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub fn ui_proxy_groups_snapshot(') &&
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
    mainRs.includes('.apply_proxy_selection(group, proxy)') &&
    mainRs.includes('.cleanup_stale_connections_after_selection()') &&
    !mainRs.includes('.select_proxy(AEGOS_OUTBOUND_IP_GROUP, &proxy, 1500)') &&
    !mainRs.includes('.select_proxy(group, proxy, 5000)') &&
    !mainRs.includes('.close_connections(1500)') &&
    !mainRs.includes('controller_request(controller_port, secret, "GET", "/proxies"') &&
    !mainRs.includes('http://127.0.0.1:{}/proxies/{}/delay') &&
    !speedTestBody.includes('select_proxy(') &&
    !speedTestBody.includes('change_proxy'),
  'proxy snapshot/delay/select controller endpoints should not leak back into main.rs or speed-test switching paths'
);

check(
  'generic CoreManager controller escape hatch is removed',
  coreRuntimeRs.includes('pub fn version_probe(&self, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn wait_until_ready') &&
    coreRuntimeRs.includes('pub fn process_exit_message') &&
    coreRuntimeRs.includes('pub const READY_REUSE_PROBE_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub const READY_PROBE_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub const READY_CHECK_ATTEMPTS') &&
    coreRuntimeRs.includes('pub const READY_RETRY_INTERVAL_MS') &&
    coreRuntimeRs.includes('pub const RUNTIME_RESTART_SETTLE_MS') &&
    coreRuntimeRs.includes('pub fn set_mode(&self, mode: &str, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn apply_mode(&self, mode: &str)') &&
    coreRuntimeRs.includes('pub const MODE_APPLY_TIMEOUT_MS') &&
    mainRs.includes('.wait_until_ready(||') &&
    mainRs.includes('core_runtime::READY_REUSE_PROBE_TIMEOUT_MS') &&
    mainRs.includes('core_runtime::RUNTIME_RESTART_SETTLE_MS') &&
    mainRs.includes('self.core_controller().apply_mode(mode)') &&
    !mainRs.includes('self.core_controller().set_mode(mode, 3000)') &&
    !mainRs.includes('version_probe(900)') &&
    !mainRs.includes('version_probe(300)') &&
    !mainRs.includes('for _ in 0..24') &&
    !mainRs.includes('fn controller(') &&
    !mainRs.includes('fn controller_request(') &&
    !mainRs.includes('self.controller('),
  'readiness, mode, and connection cleanup should use typed CoreController methods without lifecycle magic numbers in main.rs'
);

check(
  'port conflict diagnostics include owner lookup',
  mainRs.includes('fn port_owner_detail') &&
    mainRs.includes('Get-NetTCPConnection') &&
    mainRs.includes('"Mixed port availability"') &&
    mainRs.includes('"Controller port availability"'),
  'port owner diagnostics'
);

check(
  'runtime config preflight validates real launch config',
  mainRs.includes('fn preflight_runtime_config') &&
    mainRs.includes('core_runtime::preflight_runtime_config') &&
    coreRuntimeRs.includes('pub struct RuntimeConfigPreflightInput') &&
    coreRuntimeRs.includes('pub fn preflight_runtime_config') &&
    coreRuntimeRs.includes('Config preflight failed: root YAML value must be an object') &&
    coreRuntimeRs.includes('Config preflight failed: subscription has no usable proxies') &&
    coreRuntimeRs.includes('Config preflight failed: proxy group references missing target(s)') &&
    coreRuntimeRs.includes('Config preflight failed: mixed-port should be') &&
    coreRuntimeRs.includes('Config preflight failed: external-controller should end with') &&
    coreRuntimeRs.includes('runtime_config_preflight_validates_runtime_contract_inside_boundary') &&
    mainRs.includes('Config preflight passed') &&
    configPipelineRs.includes('pub(crate) fn preflight_profile_source') &&
    profileCompilerRs.includes('config_pipeline::preflight_profile_source(source, profile, settings)'),
  'profile/config preflight'
);

check(
  'settings port updates validate before save and rollback on failure',
  mainRs.includes('fn validate_port_settings_snapshot') &&
    mainRs.includes('RESERVED_MIXED_PORTS.contains(&settings.mixed_port)') &&
    mainRs.includes('settings.mixed_port == settings.controller_port') &&
    mainRs.includes('fn validate_settings_update_candidate') &&
    mainRs.includes('fn rollback_settings_after_failure') &&
    mainRs.indexOf('self.validate_settings_update_candidate(map)?') < mainRs.lastIndexOf('if let Err(err) = self.save_settings()') &&
    mainRs.includes('settings rolled back'),
  'settings port transaction'
);

check(
  'core lifecycle cleans failed starts and preserves proxy intent on restarts',
  mainRs.includes('fn terminate_core_process') &&
    mainRs.includes('core_runtime::TERMINATE_FAILED_STARTUP_MESSAGE') &&
    mainRs.includes('core_runtime::TERMINATE_STOP_MESSAGE') &&
    mainRs.includes('core_runtime::TERMINATE_EXIT_MESSAGE') &&
    mainRs.includes('core_runtime::RUNTIME_DRIFT_RESTART_MESSAGE') &&
    coreRuntimeRs.includes('pub const TERMINATE_FAILED_STARTUP_MESSAGE') &&
    coreRuntimeRs.includes('pub const TERMINATE_STOP_MESSAGE') &&
    coreRuntimeRs.includes('pub const TERMINATE_EXIT_MESSAGE') &&
    coreRuntimeRs.includes('pub const RUNTIME_DRIFT_RESTART_MESSAGE') &&
    mainRs.includes('fn restart_core_preserving_proxy') &&
    mainRs.includes('fn restore_system_proxy_preference') &&
    mainRs.includes('self.restart_core_preserving_proxy(350)?') &&
    mainRs.includes('core.restart_core_preserving_proxy(350)') &&
    mainRs.includes('if let Err(err) = self.wait_for_controller()'),
  'core lifecycle transaction'
);

check(
  'subscription import/update validate before applying',
    mainRs.includes('struct ProfileSourceSummary') &&
    mainRs.includes('fn summarize_profile_source') &&
    mainRs.includes('subscription download returned empty content') &&
    mainRs.includes('config_pipeline::preflight_profile_source(source.config, &profile, &settings)') &&
    mainRs.includes('let patched = runtime.config') &&
    mainRs.includes('"runtime-preflight"') &&
    mainRs.includes('node_count') &&
    mainRs.includes('fn profile_file_summary') &&
    mainRs.includes('fn repair_profile_metadata') &&
    mainRs.includes('fn public_profiles') &&
    mainRs.includes('Profile imported:') &&
    mainRs.includes('Profile updated:'),
  'source summary and pre-write preflight'
);

check(
  'subscription import and update rollback on runtime failure',
  mainRs.includes('Profile import applied but startup failed; rolled back') &&
    mainRs.includes('Profile update applied but startup failed; restored previous subscription') &&
    mainRs.includes('let previous_raw = fs::read_to_string(&profile_path).ok()') &&
    mainRs.includes('atomic_write_text_confined(&profile_path, &profile_root, raw)') &&
    mainRs.includes('Profile was removed before update completed') &&
    mainRs.includes('core.restore_system_proxy_preference(previous_system_proxy)'),
  'subscription file/runtime transaction'
);

check(
  'profile switch validates, hot-reloads, and rolls back on failure',
    mainRs.includes('fn preflight_profile_file') &&
    mainRs.includes('fn hot_reload_profile') &&
    mainRs.includes('fn patch_profile_file') &&
    mainRs.includes('fn launch_runtime_yaml') &&
    coreRuntimeRs.includes('pub fn write_runtime_profile') &&
    coreRuntimeRs.includes('fn atomic_write_text_confined') &&
    mainRs.includes('core_runtime::write_runtime_profile') &&
    coreRuntimeRs.includes('proxy_group_name_set') &&
    coreRuntimeRs.includes('pub struct CoreRuntimeApplyTransaction') &&
    coreRuntimeRs.includes('pub const CONFIG_FORCE_APPLY_ENDPOINT') &&
    coreRuntimeRs.includes('pub const CONFIG_FORCE_APPLY_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub const CONFIG_APPLY_VERSION_PROBE_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub fn apply_runtime_config_path(&self, path: &Path)') &&
    coreRuntimeRs.includes('pub fn config_apply_version_probe(&self)') &&
    coreRuntimeRs.includes('controller.apply_runtime_config_path(&self.runtime_profile_path)') &&
    coreRuntimeRs.includes('controller.config_apply_version_probe()') &&
    !coreRuntimeRs.includes('controller.request("GET", "/version", None, 900)') &&
    mainRs.includes('CoreRuntimeApplyTransaction::new') &&
    mainRs.includes('apply_transaction.apply(&self.core_controller())') &&
    mainRs.includes('Profile hot reload failed; falling back to restart') &&
    mainRs.includes('Profile switch preflight failed') &&
    mainRs.includes('let previous_profile_id = self.settings.active_profile_id.clone()') &&
    mainRs.includes('Profile switch failed and rolled back') &&
    mainRs.indexOf('self.preflight_profile_file(&profile)') < mainRs.indexOf('self.settings.active_profile_id = id.to_string()') &&
    mainRs.indexOf('self.settings.active_profile_id = previous_profile_id.clone()') > mainRs.indexOf('if let Err(start_err) = apply_result'),
  'set_active_profile preflight, hot reload, and rollback'
);

check(
  'proxy state model keeps selected map and resolves group references',
  mainRs.includes('selected_proxy_map') &&
    mainRs.includes('fn resolve_group_leaf') &&
    mainRs.includes('fn apply_group_resolution_with_selected_map') &&
    mainRs.includes('realProxyName') &&
    mainRs.includes('proxy_items') &&
    mainRs.includes('profile_proxy_groups_for_profile_snapshot') &&
    mainRs.includes('.selected_proxy_map') &&
    mainRs.includes('insert(group.to_string(), proxy.to_string())'),
  'FlClash-style selected map and group resolution'
);

check(
  'profile apply uses digest no-op strategy',
  mainRs.includes('mod profile_compiler') &&
    mainRs.includes('mod config_pipeline') &&
    configPipelineRs.includes('pub(crate) fn patch_config') &&
    configPipelineRs.includes('pub(crate) fn patch_direct_profile') &&
    configPipelineRs.includes('pub(crate) fn patch_profile_source') &&
    configPipelineRs.includes('pub(crate) fn patch_speed_test_source') &&
    configPipelineRs.includes('pub(crate) fn speed_test_firewall_ports_from_source') &&
    configPipelineRs.includes('pub(crate) fn preflight_config') &&
    configPipelineRs.includes('pub(crate) fn patch_and_preflight') &&
    configPipelineRs.includes('pub(crate) fn preflight_profile_source') &&
    profileCompilerRs.includes('pub(crate) struct RenderedProfile') &&
    profileCompilerRs.includes('pub(crate) fn compile_profile_file') &&
    profileCompilerRs.includes('pub(crate) fn compile_profile_source') &&
    profileCompilerRs.includes('config_pipeline::preflight_profile_source(source, profile, settings)') &&
    !profileCompilerRs.includes('patch_config_with_settings') &&
    !profileCompilerRs.includes('preflight_runtime_config') &&
    profileCompilerRs.includes('digest: sha256_text(&yaml)') &&
    mainRs.includes('profile_compiler::compile_profile_file(profile, settings)') &&
    mainRs.includes('config_pipeline::preflight_profile_source(source.config, &profile, &settings)') &&
    mainRs.includes('config_pipeline::preflight_profile_source(source.clone(), &profile, &settings)') &&
    mainRs.includes('config_pipeline::patch_profile_source(source, profile, &settings)') &&
    mainRs.includes('config_pipeline::patch_direct_profile(&self.settings)') &&
    mainRs.includes('config_pipeline::speed_test_firewall_ports_from_source(') &&
    !mainRs.includes('config_pipeline::patch_speed_test_source(') &&
    !mainRs.includes('proxy_ports_from_config') &&
    !mainRs.includes('config_pipeline::patch_config(') &&
    !mainRs.includes('config_pipeline::patch_and_preflight(') &&
    !mainRs.includes('config_pipeline::preflight_config(') &&
    !mainRs.includes('let patched = patch_config_with_settings(source, settings, Some(&profile.id))?') &&
    mainRs.includes('runtime_config_digest') &&
    mainRs.includes('Profile apply skipped; unchanged runtime config digest') &&
    mainRs.includes('"skipped": true') &&
    mainRs.includes('runtime_config_digest_is_stable_until_settings_change'),
  'digest-based config apply skip'
);

check(
  'core-changing operations use a shared operation queue',
  mainRs.includes('operations: Arc<Mutex<()>>') &&
    mainRs.includes('fn lock_operation_queue') &&
    ['startCore', 'stopCore', 'restartCore', 'setActiveProfile', 'updateSettings', 'updateSetting', 'setMode', 'changeProxy'].every((name) => mainRs.includes(`"${name}"`) && mainRs.includes(`"${name}"`)) &&
    mainRs.includes('operation_queue_is_exclusive') &&
    mainRs.includes('set_active_profile command') &&
    mainRs.includes('lock_operation_queue(&operations, "changeProxy")'),
  'operation queue for core/system mutations'
);

check(
  'running subscription switch preflight has local integration coverage',
  mainRs.includes('Profile switch requested:') &&
    mainRs.includes('Profile switch completed:') &&
    mainRs.includes('Profile switch preflight failed for') &&
    mainRs.includes('running_switch_preflight_accepts_two_local_profiles'),
  'profile switch diagnostics and local integration test'
);

check(
  'subscription failures are classified with actionable diagnostics',
  mainRs.includes('fn subscription_diagnostic') &&
    mainRs.includes('download_profile_source_url_diagnostic') &&
    mainRs.includes('parse_uri_subscription_source_diagnostic') &&
    mainRs.includes('"unsupported-format"') &&
    mainRs.includes('"unsupported-protocol"') &&
    mainRs.includes('"runtime-preflight"') &&
    mainRs.includes('subscription_diagnostics_classify_unsupported_protocols'),
  'download, format, protocol, and runtime preflight diagnostics'
);

check(
  'protocol capability matrix rejects core-unsupported proxy types',
  mainRs.includes('const AEGOS_URI_PROTOCOLS') &&
    !mainRs.includes('const MIHOMO_PROXY_TYPES') &&
    !mainRs.includes('fn mihomo_supports_proxy_type') &&
    !mainRs.includes('fn protocol_capability_summary') &&
    coreRuntimeRs.includes('pub const SUPPORTED_PROXY_TYPES') &&
    coreRuntimeRs.includes('pub fn supports_proxy_type') &&
    coreRuntimeRs.includes('pub fn protocol_capability_summary') &&
    coreRuntimeRs.includes('pub fn protocol_capabilities_json') &&
    mainRs.includes('core_runtime::supports_proxy_type') &&
    coreRuntimeRs.includes('protocol_capabilities_json') &&
    coreRuntimeRs.includes('unsupported_proxy_types') &&
    coreRuntimeRs.includes('Config preflight failed: unsupported proxy type(s)') &&
    mainRs.includes('preflight_rejects_core_unsupported_proxy_type') &&
    mainRs.includes('manual_hy2_node_is_normalized_to_hysteria2') &&
    coreRuntimeRs.includes('runtime_protocol_capabilities_normalize_and_report_current_contract'),
  'parser/runtime/manual protocol support stays explicit at runtime boundary'
);

check(
  'sanitized subscription fixture regression exists',
  mainRs.includes('sanitized_subscription_fixtures_parse_without_real_tokens') &&
    mainRs.includes('sanitized_subscription_fixture_reports_unsupported_protocols') &&
    mainRs.includes('include_str!("../fixtures/subscriptions/clash-basic.yaml")') &&
    mainRs.includes('include_str!("../fixtures/subscriptions/mixed-uri.txt")') &&
    mainRs.includes('include_str!("../fixtures/subscriptions/unsupported-protocol.txt")'),
  'real-use parser regression without real airport tokens'
);

check(
  'node switching preflights group and proxy before mutating selection',
  (() => {
    const body = mainRs.match(/fn change_proxy\(&mut self, group: &str, proxy: &str\) -> Result<bool, String> \{([\s\S]*?)\n    \}/)?.[1] || '';
    return mainRs.includes('fn validate_proxy_selection_from_groups') &&
      mainRs.includes('Node switch preflight failed') &&
      mainRs.includes('Node switch preflight passed') &&
      mainRs.includes('node_switch_preflight_validates_group_and_proxy') &&
      body.includes('let groups = self.proxy_groups();') &&
      body.includes('validate_proxy_selection_from_groups(&groups, group, proxy)?') &&
      body.indexOf('validate_proxy_selection_from_groups') < body.indexOf('selected_proxy_map');
  })(),
  'change_proxy validates current group/node snapshot first'
);

check(
  'connection closure is returned by connect and node switch jobs',
  mainRs.includes('fn connection_closure(&self) -> JsonValue') &&
    mainRs.includes('"coreRunning"') &&
    mainRs.includes('"systemProxyApplied"') &&
    mainRs.includes('"currentNode"') &&
    mainRs.includes('"outboundIpKnown"') &&
    mainRs.includes('"connection": self.connection_closure()') &&
    mainRs.includes('let connection = core.connection_closure();') &&
    mainRs.includes('json!({ "group": group, "proxy": proxy, "connection": connection })'),
  'core running, takeover, system proxy, node, and outbound IP closure'
);

check(
  'connection failures are classified for user-facing actions',
  mainRs.includes('fn classify_failure_reason') &&
    ['timeout', 'dns', 'tls', 'auth', 'unsupported-protocol', 'port-conflict', 'controller-unavailable', 'config', 'network'].every((item) => mainRs.includes(`"${item}"`)) &&
    mainRs.includes('fn classified_error') &&
    mainRs.includes('failure_reason_classifier_covers_common_connection_failures') &&
    mainRs.includes('return Err(classified_error("Node switch", err));'),
  'timeout/DNS/TLS/auth/controller/config/network classifications'
);

check(
  'speed engine tracks node health and low-latency recommendations',
  mainRs.includes('struct NodeHealth') &&
    mainRs.includes('fn update_node_health') &&
    mainRs.includes('failure_streak') &&
    mainRs.includes('cooldown_until') &&
    mainRs.includes('lowLatency') &&
    mainRs.includes('recommended') &&
    mainRs.includes('recommendation_requires_sub_100ms_available_node'),
  'node health, cooldown, and recommendation model'
);

check(
  'speed results expose confidence and freshness',
  mainRs.includes('SPEED_RESULT_HIGH_CONFIDENCE_SECS') &&
    mainRs.includes('fn speed_result_confidence') &&
    mainRs.includes('fn speed_confidence_summary') &&
    mainRs.includes('"healthConfidence"') &&
    mainRs.includes('"resultAgeSecs"') &&
    mainRs.includes('"recommendedFresh"') &&
    mainRs.includes('speed_result_confidence_tracks_fresh_stale_and_failed_results'),
  'fresh/stale/failed confidence metadata'
);

check(
  'best proxy selection is routed through background jobs',
  mainRs.includes('fn select_best_proxy') &&
    mainRs.includes('"selectBestProxy"') &&
    mainRs.includes('latency<100ms') &&
    mainRs.includes('lock_operation_queue(&operations, "selectBestProxy")'),
  'best proxy operation queue'
);

check(
  'recovery suggestions are controlled and same-region aware',
  mainRs.includes('fn recovery_suggestions') &&
    mainRs.includes('fn infer_node_region') &&
    mainRs.includes('fn recovery_confidence_rank') &&
    mainRs.includes('"requiresConfirmation"') &&
    mainRs.includes('"sameRegion"') &&
    mainRs.includes('"suggestions": self.recovery_suggestions(5)') &&
    mainRs.includes('recovery_suggestions_rank_same_region_and_fresh_results'),
  'same-region suggestions require confirmation'
);

check(
  'node-level diagnostics link health, logs, and suggestions',
  mainRs.includes('fn node_diagnostics_from_snapshot') &&
    mainRs.includes('fn recent_node_logs_from_snapshot') &&
    mainRs.includes('fn log_matches_node') &&
    mainRs.includes('"lastFailure"') &&
    mainRs.includes('classify_failure_reason(&entry.line)') &&
    mainRs.includes('fn recovery_suggestions_from_snapshot') &&
    mainRs.includes('recovery_suggestions_from_snapshot(groups, speed, max_delay_ms, 8)') &&
    mainRs.includes('node_diagnostics_from_snapshot(name, &groups, &speed, &logs, max_delay_ms)') &&
    !mainRs.includes('state.core.lock().unwrap().node_diagnostics(name)') &&
    mainRs.includes('node_log_matching_finds_related_failures') &&
    mainRs.includes('node_diagnostics,'),
  'node health/log/suggestion diagnostics reuse one group snapshot without holding the core mutex'
);

check(
  'active profile removal reconciles running core',
  mainRs.includes('"removeProfile"') &&
    mainRs.includes('fn remove_profile') &&
    mainRs.includes('let was_running = self.process.is_some()') &&
    mainRs.includes('let was_active = self.settings.active_profile_id == id') &&
    mainRs.includes('if was_running && was_active') &&
    mainRs.includes('self.start()?'),
  'remove active profile restarts on direct'
);

const result = { ok: fail.length === 0, failed: fail, passed: pass };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
