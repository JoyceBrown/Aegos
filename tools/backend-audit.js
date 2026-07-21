import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function readSource(...segments) {
  return fs.readFileSync(path.join(root, ...segments), 'utf8').replace(/\r\n/g, '\n');
}

const mainRs = readSource('src-tauri', 'src', 'main.rs');
const coreDomainRs = readSource('src-tauri', 'src', 'core_domain.rs');
const configDomainRs = readSource('src-tauri', 'src', 'config_domain.rs');
const coreRuntimeRs = readSource('src-tauri', 'src', 'core_runtime.rs');
const profileCompilerRs = readSource('src-tauri', 'src', 'profile_compiler.rs');
const configPipelineRs = readSource('src-tauri', 'src', 'config_pipeline.rs');
const taskRuntimeRs = readSource('src-tauri', 'src', 'task_runtime.rs');
const speedRuntimeRs = readSource('src-tauri', 'src', 'speed_runtime.rs');
const speedSchedulerRs = readSource('src-tauri', 'src', 'speed_scheduler.rs');
const diagnosticsRuntimeRs = readSource('src-tauri', 'src', 'diagnostics_runtime.rs');
const subscriptionRuntimeRs = readSource('src-tauri', 'src', 'subscription_runtime.rs');
const configDeploymentRs = readSource('src-tauri', 'src', 'config_deployment.rs');
const runtimeCommandRs = readSource('src-tauri', 'src', 'runtime_command.rs');

const fail = [];
const pass = [];

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

const statusBody = mainRs.match(/fn status_from_observed_traffic\([\s\S]*?\) -> JsonValue \{([\s\S]*?)\n    \}/)?.[1] || '';
const appStatusBody = mainRs.match(/fn app_status\([^)]*\) -> Result<JsonValue, String> \{([\s\S]*?)\n\}/)?.[1] || '';
const commandSection = mainRs.slice(mainRs.indexOf('#[tauri::command]'));
const speedStart = mainRs.indexOf('fn start_proxy_delay_test');
const speedEnd = mainRs.indexOf('fn test_single_proxy_delay', speedStart);
const speedTestBody = speedStart >= 0 && speedEnd > speedStart ? mainRs.slice(speedStart, speedEnd) : '';
const speedCommandStart = mainRs.indexOf('fn start_proxy_delay_test(');
const speedCommandEnd = mainRs.indexOf('#[tauri::command]', speedCommandStart + 1);
const speedCommandBody = speedCommandStart >= 0 && speedCommandEnd > speedCommandStart ? mainRs.slice(speedCommandStart, speedCommandEnd) : '';
const singleSpeedCommandStart = mainRs.indexOf('fn test_single_proxy_delay(');
const singleSpeedCommandEnd = mainRs.indexOf('#[tauri::command]', singleSpeedCommandStart + 1);
const singleSpeedCommandBody = singleSpeedCommandStart >= 0 && singleSpeedCommandEnd > singleSpeedCommandStart ? mainRs.slice(singleSpeedCommandStart, singleSpeedCommandEnd) : '';
const singleSpeedBackendStart = mainRs.indexOf('fn test_single_proxy_delay_for_run');
const singleSpeedBackendEnd = mainRs.indexOf('fn probe_proxy_network', singleSpeedBackendStart);
const singleSpeedBackendBody = singleSpeedBackendStart >= 0 && singleSpeedBackendEnd > singleSpeedBackendStart ? mainRs.slice(singleSpeedBackendStart, singleSpeedBackendEnd) : '';
const activeConnectionCommandBody = mainRs.match(/fn active_connection_count\(state: State<AppState>\) -> Result<JsonValue, String> \{([\s\S]*?)\n\}/)?.[1] || '';
const connectionStatusSummaryBody = mainRs.match(/fn connection_status_summary\(&self\) -> JsonValue \{([\s\S]*?)\n    \}/)?.[1] || '';
const connectionClosureBody = mainRs.match(/fn connection_closure\(&self\) -> JsonValue \{([\s\S]*?)\n    \}/)?.[1] || '';
const outboundIpRefreshStart = mainRs.indexOf('fn refresh_outbound_ip_detached');
const outboundIpRefreshEnd = mainRs.indexOf('fn update_all_profiles_detached', outboundIpRefreshStart);
const outboundIpRefreshBody = outboundIpRefreshStart >= 0 && outboundIpRefreshEnd > outboundIpRefreshStart
  ? mainRs.slice(outboundIpRefreshStart, outboundIpRefreshEnd)
  : '';
const outboundIpIdentityIndex = outboundIpRefreshBody.indexOf('if !outbound_ip_query_is_current(');
const outboundIpStaleReturnIndex = outboundIpRefreshBody.indexOf('Outbound IP query expired after node changed; retrying will use the current node.');
const outboundIpFallbackIndex = outboundIpRefreshBody.indexOf('let fallback = core.outbound_ip_cache.trim().to_string()');
const publicProfileStart = mainRs.indexOf('fn public_profile(');
const publicProfileEnd = mainRs.indexOf('fn is_fake_ip_address(', publicProfileStart);
const publicProfileBody = publicProfileStart >= 0 && publicProfileEnd > publicProfileStart
  ? mainRs.slice(publicProfileStart, publicProfileEnd)
  : '';

function hasControllerCall(method, timeout) {
  return new RegExp(`controller\\s*\\.\\s*${method}\\(\\s*${timeout}\\s*\\)`).test(mainRs);
}

function hasControllerCallWithArg(method, arg, timeout) {
  return new RegExp(`controller\\s*\\.\\s*${method}\\(\\s*${arg}\\s*,\\s*${timeout}\\s*\\)`).test(mainRs);
}

check(
  'status snapshot avoids controller version probe',
  !statusBody.includes('"/version"') &&
    statusBody.includes('core_runtime::status_surface_json') &&
    coreRuntimeRs.includes('pub fn status_surface_json(') &&
    coreRuntimeRs.includes('pub fn runtime_status_json(') &&
    coreRuntimeRs.includes('"version": JsonValue::Null') &&
    !statusBody.includes('"version": JsonValue::Null'),
  'app_status should stay lightweight'
);
check(
  'status traffic timeout stays short',
  appStatusBody.includes('status_traffic_snapshot_or_idle(observed_running, &previous_traffic)') &&
    coreDomainRs.includes('pub struct TrafficSnapshot') &&
    coreDomainRs.includes('pub fn traffic_snapshot_from_controller_line') &&
    coreRuntimeRs.includes('Result<TrafficSnapshot, String>') &&
    coreRuntimeRs.includes('pub fn status_traffic_snapshot(&self)') &&
    coreRuntimeRs.includes('pub fn status_traffic_snapshot_or_idle(') &&
    coreRuntimeRs.includes('pub fn idle_traffic_snapshot()') &&
    coreRuntimeRs.includes('pub const STATUS_TRAFFIC_TIMEOUT_MS') &&
    !mainRs.includes('fn traffic_snapshot(&self)') &&
    !appStatusBody.includes('traffic_snapshot(120)') &&
    !appStatusBody.includes('traffic_snapshot(450)'),
  'traffic snapshot timeout'
);
check(
  'outbound IP refresh ignores stale node results',
  mainRs.includes('outbound_ip_query_generation: u64') &&
    outboundIpRefreshBody.includes('outbound_ip_query_generation = core.outbound_ip_query_generation.saturating_add(1)') &&
    mainRs.includes('fn runtime_current_proxy_route(') &&
    mainRs.includes('fn sync_outbound_ip_route(') &&
    mainRs.includes('OUTBOUND_IP_RULE_PRIMARY_GROUPS') &&
    mainRs.includes('OUTBOUND_IP_GLOBAL_PRIMARY_GROUPS') &&
    coreDomainRs.includes('pub fn resolve_runtime_leaf(') &&
    coreDomainRs.includes('pub fn group_contains_leaf(') &&
    outboundIpRefreshBody.includes('let selected_proxy = sync_outbound_ip_route(&controller, &mode)?') &&
    mainRs.includes('fn outbound_ip_query_is_current(') &&
    mainRs.includes('fn outbound_ip_query_identity_rejects_stale_contexts()') &&
    outboundIpIdentityIndex >= 0 &&
    outboundIpStaleReturnIndex > outboundIpIdentityIndex &&
    outboundIpFallbackIndex > outboundIpStaleReturnIndex &&
    !outboundIpRefreshBody.includes('current_outbound_ip_proxy_name') &&
    outboundIpRefreshBody.includes('Outbound IP refresh result ignored because the selected node changed.') &&
    outboundIpRefreshBody.includes('Outbound IP query expired after node changed; retrying will use the current node.') &&
    mainRs.includes('Unable to query outbound IP') &&
    !outboundIpRefreshBody.includes('鐠囧嘲') &&
    !mainRs.includes('閺冪姵纭堕懢宄板絿'),
  'old outbound IP lookups must not overwrite cache after node/profile changes'
);
check(
  'speed tests run in background thread',
  mainRs.includes('fn start_proxy_delay_test') && mainRs.includes('thread::spawn(move ||') && mainRs.includes('speed_test_snapshot'),
  'background delay test'
);
check(
  'batch speed-test command returns before slow core preparation',
  speedCommandBody.includes('mark_speed_test_preparing(&state.speed_test, now_secs())') &&
    speedCommandBody.includes('thread::spawn(move ||') &&
    speedCommandBody.includes('start_proxy_delay_test_for_run(Some(run_id), app, priority_names)') &&
    !speedCommandBody.includes('state.core.lock().unwrap().start_proxy_delay_test()'),
  'clicking speed test should not wait for standby core preparation or proxy-group assembly'
);
check(
  'single-node speed-test command returns before slow core preparation',
  singleSpeedCommandBody.includes('mark_single_speed_test_preparing(&state.speed_test, &name, now_secs())') &&
    singleSpeedCommandBody.includes('thread::spawn(move ||') &&
    singleSpeedCommandBody.includes('test_single_proxy_delay_for_run(name, Some(run_id), app)') &&
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
  mainRs.includes('fn build_kill_switch_script') &&
    mainRs.includes('core_runtime::firewall_program_paths') &&
    !mainRs.includes('fn build_speed_test_firewall_script') &&
    !speedTestBody.includes('run_powershell') &&
    !singleSpeedBackendBody.includes('run_powershell') &&
    !mainRs.includes('remoteport=$portList'),
  'speed tests reuse verified Aegos/core program allow rules without broad temporary port rules'
);
check(
  'TUIC delay path has bounded protocol-aware concurrency',
  mainRs.includes('fn protocol_concurrency') &&
    mainRs.includes('"tuic" => 10') &&
    mainRs.includes('speed_test_ordered_targets') &&
    speedSchedulerRs.includes('family_limits') &&
    speedSchedulerRs.includes('run_probe_wave') &&
    mainRs.includes('protocol_primary_timeout_ms'),
  'protocol-aware concurrency'
);
check(
  'modern URI airport protocols are parsed',
  subscriptionRuntimeRs.includes('fn parse_vless_uri') &&
    subscriptionRuntimeRs.includes('fn parse_hysteria2_uri') &&
    subscriptionRuntimeRs.includes('fn parse_anytls_uri') &&
    subscriptionRuntimeRs.includes('Some("hysteria2" | "hy2")') &&
    subscriptionRuntimeRs.includes('Some("vless")') &&
    subscriptionRuntimeRs.includes('Some("anytls")') &&
    !mainRs.includes('fn parse_vless_uri') &&
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
    configPipelineRs.includes('harden_runtime_dns(&mut config, settings)') &&
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
  configDomainRs.includes('pub fn is_subscription_metadata_node_name') &&
    configPipelineRs.includes('fn sanitize_subscription_metadata_nodes') &&
    mainRs.includes('subscription_metadata_nodes_are_removed_before_runtime_and_speed') &&
    mainRs.includes('config_domain::is_subscription_metadata_node_name(name)') &&
    mainRs.includes('is_fake_ip_address(server)'),
  'Traffic/Expire plan rows must not become selectable or speed-tested nodes'
);
check(
  'runtime proxy-group config shaping is owned by config_pipeline',
  configPipelineRs.includes('pub(crate) fn normalize_runtime_proxy_groups_for_display') &&
    configPipelineRs.includes('fn synthesize_default_proxy_groups_if_needed') &&
    configPipelineRs.includes('fn ensure_proxies_group_contains_all_nodes') &&
    configPipelineRs.includes('fn ensure_auto_select_group_contains_all_nodes') &&
    configPipelineRs.includes('set_yaml(map, "lazy", YamlValue::Bool(true))') &&
    coreRuntimeRs.includes('pub const LEGACY_AEGOS_AUTO_SELECT_GROUP_NAME') &&
    coreRuntimeRs.includes('name == LEGACY_AEGOS_AUTO_SELECT_GROUP_NAME') &&
    configPipelineRs.includes('core_runtime::AEGOS_AUTO_SELECT_GROUP_NAME') &&
    configPipelineRs.includes('matching_indices.into_iter().skip(1).rev()') &&
    mainRs.includes('config_pipeline::normalize_runtime_proxy_groups_for_display') &&
    mainRs.includes('config_pipeline::is_internal_proxy_group_name') &&
    !mainRs.includes('fn synthesize_default_proxy_groups_if_needed') &&
    !mainRs.includes('fn ensure_proxies_group_contains_all_nodes') &&
    !mainRs.includes('fn ensure_auto_select_group_contains_all_nodes') &&
    !mainRs.includes('fn normalize_profile_groups_for_display'),
  'default Proxies/auto-select group generation must stay out of main.rs'
);
check(
  'long operations expose background job API',
  ['start_job', 'job_status', 'cancel_job'].every((name) => commandSection.includes(`fn ${name}`)) &&
    ['addProfileUrl', 'updateProfile', 'setActiveProfile', 'updateSetting', 'updateSettings', 'setMode', 'changeProxy', 'recoverNetwork', 'refreshOutboundIp', 'diagnostics', 'startCore', 'stopCore', 'restartCore'].every((name) => mainRs.includes(name)),
  'background jobs for core power, settings, mode/proxy, subscription, recovery, diagnostics, and outbound IP'
);
check(
  'background job state model is owned by task_runtime',
  mainRs.includes('mod task_runtime') &&
    mainRs.includes('jobs: JobStore') &&
    mainRs.includes('new_job_record(id.clone(), kind.clone(), job_label(&kind))') &&
    mainRs.includes('job_status_snapshot(&state.jobs, id)') &&
    mainRs.includes('request_job_cancel(&state.jobs, &id)') &&
    taskRuntimeRs.includes('pub type JobStore') &&
    taskRuntimeRs.includes('pub struct JobRecord') &&
    taskRuntimeRs.includes('pub fn set_job_state(') &&
    taskRuntimeRs.includes('pub fn job_cancel_requested(') &&
    taskRuntimeRs.includes('pub fn finish_job(') &&
    taskRuntimeRs.includes('pub fn job_status_snapshot(') &&
    taskRuntimeRs.includes('pub fn request_job_cancel(') &&
    taskRuntimeRs.includes('job_store_cancels_and_prunes_finished_jobs') &&
    !mainRs.includes('struct JobRecord') &&
    !mainRs.includes('fn finish_job(') &&
    !mainRs.includes('fn request_job_cancel('),
  'job records, cancellation, pruning, and terminal state updates should not be duplicated in main.rs'
);

check(
  'speed-test state model is owned by speed_runtime',
  mainRs.includes('mod speed_runtime') &&
    mainRs.includes('speed_test: SpeedTestStore') &&
    mainRs.includes('speed_test_runtime_snapshot(&state.speed_test, now_secs())') &&
    mainRs.includes('reset_speed_test_runtime_state(&state.speed_test, "cancelled", false, now_secs())') &&
    speedRuntimeRs.includes('pub type SpeedTestStore') &&
    speedRuntimeRs.includes('pub struct SpeedTestState') &&
    speedRuntimeRs.includes('pub struct NodeHealth') &&
    speedRuntimeRs.includes('pub fn mark_speed_test_preparing(') &&
    speedRuntimeRs.includes('pub fn mark_single_speed_test_preparing(') &&
    speedRuntimeRs.includes('pub fn speed_test_run_is_current(') &&
    speedRuntimeRs.includes('pub fn fail_speed_test_if_current(') &&
    speedRuntimeRs.includes('pub fn reset_speed_test_state(') &&
    speedRuntimeRs.includes('speed_store_preserves_health_when_preparing_new_run') &&
    !mainRs.includes('struct SpeedTestState') &&
    !mainRs.includes('struct NodeHealth') &&
    !mainRs.includes('fn speed_test_snapshot_from_state') &&
    !mainRs.includes('fn reset_speed_test_state_from_state'),
  'speed-test run state, health records, snapshots, cancel, and failure transitions should not be duplicated in main.rs'
);

check(
  'subscription and outbound IP jobs reduce core lock scope',
    mainRs.includes('add_profile_url_detached') &&
    mainRs.includes('update_profile_detached') &&
    mainRs.includes('refresh_outbound_ip_detached') &&
    mainRs.includes('subscription_runtime::download_source_url(url, AEGOS_SUBSCRIPTION_USER_AGENT)?') &&
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
    configPipelineRs.includes('fn upsert_outbound_ip_group') &&
    mainRs.includes('fn sync_outbound_ip_group_selection') &&
    configPipelineRs.includes('fn insert_outbound_ip_rules') &&
    configPipelineRs.includes('DOMAIN,{domain},{target}') &&
    mainRs.includes('outbound_ip_lookup_rules_use_internal_current_node_group'),
  'internal IP lookup domains are routed through a hidden group synced to the current node'
);

check(
  'core startup failures include actionable diagnostics',
  mainRs.includes('fn start_failure_message') &&
    mainRs.includes('recent_log_summary') &&
    mainRs.includes('CoreStartFailureContext::new') &&
    mainRs.includes('.message(reason)') &&
    coreRuntimeRs.includes('pub struct CoreStartFailureContext') &&
    coreRuntimeRs.includes('Core startup failed: {reason}') &&
    coreRuntimeRs.includes('profile: no active profile') &&
    mainRs.includes('Config generation failed: {err}') &&
    mainRs.includes('Core process spawn failed: {err}') &&
    mainRs.includes('if let Err(err) = self.wait_for_controller()') &&
    mainRs.includes('self.terminate_core_process(core_runtime::TERMINATE_FAILED_STARTUP_MESSAGE)') &&
    mainRs.includes('return Err(message);') &&
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
  coreRuntimeRs.includes('pub fn diagnostic_check_json') &&
    coreRuntimeRs.includes('pub fn diagnostic_summary_json') &&
    coreRuntimeRs.includes('"severity"') &&
    coreRuntimeRs.includes('"hint"') &&
    coreRuntimeRs.includes('"actionable"') &&
    coreRuntimeRs.includes('"nextActions"') &&
    mainRs.includes('"summary": summary') &&
    mainRs.includes('core_runtime::diagnostic_summary_json(&checks)') &&
    mainRs.includes('let admin_required = snapshot.settings.tun_enabled || snapshot.settings.kill_switch_enabled') &&
    mainRs.includes('let admin_ok = is_admin || !admin_required'),
  'diagnostic metadata'
);

check(
  'system proxy takeover snapshots and restores previous Windows proxy',
  coreRuntimeRs.includes('pub struct SystemProxySnapshot') &&
    coreRuntimeRs.includes('pub fn system_proxy_snapshot_points_to_aegos') &&
    coreRuntimeRs.includes('pub fn should_capture_system_proxy_snapshot') &&
    coreRuntimeRs.includes('system_proxy_snapshot_policy_is_owned_by_runtime_boundary') &&
    !mainRs.includes('struct SystemProxySnapshot') &&
    mainRs.includes('fn read_windows_proxy_snapshot') &&
    mainRs.includes('fn write_windows_proxy_snapshot') &&
    mainRs.includes('fn capture_proxy_snapshot_before_takeover') &&
    mainRs.includes('core_runtime::should_capture_system_proxy_snapshot') &&
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
    mainRs.includes('CoreTrafficTakeoverPlan::after_core_ready') &&
    coreRuntimeRs.includes('pub struct CoreTrafficTakeoverPlan') &&
    coreRuntimeRs.includes('|| !tun_enabled') &&
    coreRuntimeRs.includes('traffic_takeover_after_ready_is_owned_by_runtime_boundary') &&
    coreRuntimeRs.includes('tun_off_requires_system_proxy') &&
    mainRs.includes('self.settings.system_proxy = true;') &&
    mainRs.includes('self.set_system_proxy(true)'),
  'connect should still take over traffic through Windows system proxy when TUN is off'
);

check(
  'active connection count uses short controller query',
  coreRuntimeRs.includes('pub fn active_connection_count(&self, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn active_connection_count_snapshot_or_idle(') &&
    coreRuntimeRs.includes('pub fn connections_snapshot(&self, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn connections_snapshot_or_empty(') &&
    coreRuntimeRs.includes('pub fn recent_rule_hits_snapshot(') &&
    coreRuntimeRs.includes('pub fn routing_recent_rule_hits_snapshot_or_empty(&self, running: bool)') &&
    coreDomainRs.includes('pub struct ConnectionSnapshot') &&
    coreDomainRs.includes('pub fn connection_snapshots_from_controller') &&
    coreDomainRs.includes('pub fn recent_rule_hits') &&
    coreRuntimeRs.includes('Result<Vec<ConnectionSnapshot>, String>') &&
    !coreRuntimeRs.includes('recent_rule_hits_from_connections') &&
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
  mainRs.includes('speed_test: SpeedTestStore') &&
    mainRs.includes('logs: LogStore') &&
    mainRs.includes('app_data: PathBuf') &&
    speedRuntimeRs.includes('pub fn speed_test_snapshot(') &&
    diagnosticsRuntimeRs.includes('pub type LogStore') &&
    diagnosticsRuntimeRs.includes('pub fn logs_export_document(') &&
    mainRs.includes('fn export_logs_from_state') &&
    mainRs.includes('fn speed_test_status(state: State<AppState>)') &&
    mainRs.includes('speed_test_runtime_snapshot(&state.speed_test, now_secs())') &&
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
    mainRs.includes('controller: core_runtime::CoreController') &&
    coreRuntimeRs.includes('pub fn proxy_catalog_snapshot_or_else') &&
    mainRs.includes('fn profile_proxy_groups_for_profile_snapshot') &&
    mainRs.includes('fn apply_speed_test_delays_from_state') &&
    mainRs.includes("async fn proxy_groups(state: State<'_, AppState>)") &&
    mainRs.includes('assemble_proxy_groups_snapshot(') &&
    mainRs.includes('core.core_controller()') &&
    mainRs.includes('core_runtime::shape_proxy_catalog_model(') &&
    coreDomainRs.includes('pub struct ProxyCatalog') &&
    coreDomainRs.includes('pub fn ensure_default_groups') &&
    coreDomainRs.includes('pub fn apply_selected_map') &&
    coreDomainRs.includes('pub fn annotate_manual_nodes') &&
    coreRuntimeRs.includes('pub fn shape_proxy_catalog_model(') &&
    coreRuntimeRs.includes('proxy_group_snapshot_defaults_are_shaped_inside_runtime_boundary') &&
    mainRs.includes('fn preview_profile_groups(state: State<AppState>, id: String)') &&
    mainRs.includes('profile_proxy_groups_for_profile_snapshot(') &&
    !mainRs.includes('fn assemble_proxy_groups_snapshot(\n    running: bool,\n    controller_port: u16') &&
    !mainRs.includes('fn assemble_proxy_groups_snapshot(\n    running: bool,\n    controller: core_runtime::CoreController,\n    secret:') &&
    !mainRs.includes('fn normalize_proxy_groups_snapshot_defaults') &&
    !mainRs.includes('fn apply_group_resolution_with_selected_map') &&
    !mainRs.includes('fn annotate_manual_groups_with_names') &&
    !coreRuntimeRs.includes('pub fn normalize_proxy_groups_snapshot_defaults(') &&
    !coreRuntimeRs.includes('pub fn apply_group_resolution_with_selected_map(') &&
    !coreRuntimeRs.includes('pub fn annotate_manual_groups_with_names(') &&
    !mainRs.includes('state.core.lock().unwrap().proxy_groups()') &&
    !mainRs.includes('state.core.lock().unwrap().preview_profile_groups(&id)'),
  'node list refresh and subscription preview should snapshot core state, then do controller/file parsing outside the core lock'
);

check(
  'proxy controller APIs are typed and keep speed tests measurement-only',
  coreRuntimeRs.includes('fn proxies_payload(&self, timeout_ms: u64)') &&
    !coreRuntimeRs.includes('pub fn proxies_payload') &&
    coreRuntimeRs.includes('fn proxy_groups_snapshot(') &&
    !coreRuntimeRs.includes('pub fn proxy_groups_snapshot(') &&
    coreRuntimeRs.includes('pub fn proxy_catalog_snapshot(') &&
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
    coreRuntimeRs.includes('pub fn proxy_catalog_snapshot_or_else') &&
    coreRuntimeRs.includes('pub const PROXY_GROUPS_SNAPSHOT_TIMEOUT_MS') &&
    coreRuntimeRs.includes('pub fn proxy_delay_with_client(') &&
    coreDomainRs.includes('pub struct DelayProbeSnapshot') &&
    coreDomainRs.includes('pub fn delay_probe_from_controller') &&
    coreRuntimeRs.includes('Result<DelayProbeSnapshot, CoreControllerHttpFailure>') &&
    coreRuntimeRs.includes('pub fn proxy_delay_result_with_client(') &&
    coreRuntimeRs.includes('pub fn classify_delay_http_failure(') &&
    coreRuntimeRs.includes('#[derive(Clone, Debug)]') &&
    coreRuntimeRs.includes('pub struct CoreController') &&
    mainRs.includes('controller.proxy_catalog_snapshot_or_else(') &&
    mainRs.includes('&[AEGOS_OUTBOUND_IP_GROUP]') &&
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
    mainRs.includes('.apply_proxy_selection_with_cleanup(group, proxy)') &&
    !mainRs.includes('.apply_proxy_selection(group, proxy)') &&
    !mainRs.includes('.cleanup_stale_connections_after_selection()') &&
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
    coreRuntimeRs.includes('fn request(') &&
    !coreRuntimeRs.includes('pub fn request(') &&
    coreRuntimeRs.includes('fn controller_request(') &&
    !coreRuntimeRs.includes('pub fn controller_request') &&
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
  configPipelineRs.includes('core_runtime::preflight_runtime_config(') &&
    configPipelineRs.includes('subscription_runtime::AEGOS_URI_PROTOCOLS') &&
    coreRuntimeRs.includes('pub struct RuntimeConfigPreflightInput') &&
    coreRuntimeRs.includes('pub fn preflight_runtime_config') &&
    coreRuntimeRs.includes('Config preflight failed: root YAML value must be an object') &&
    coreRuntimeRs.includes('Config preflight failed: subscription has no usable proxies') &&
    coreRuntimeRs.includes('Config preflight failed: proxy group references missing target(s)') &&
    coreRuntimeRs.includes('Config preflight failed: mixed-port should be') &&
    coreRuntimeRs.includes('Config preflight failed: external-controller should end with') &&
    coreRuntimeRs.includes('runtime_config_preflight_validates_runtime_contract_inside_boundary') &&
    mainRs.includes('Config preflight passed') &&
    configDomainRs.includes('pub struct RuntimeConfigReport') &&
    configPipelineRs.includes('pub(crate) fn compile_runtime_catalog') &&
    !configPipelineRs.includes('patch_config_with_settings') &&
    profileCompilerRs.includes('pub(crate) struct RuntimeDeploymentPlan') &&
    profileCompilerRs.includes('config_pipeline::compile_runtime_catalog('),
  'profile/config preflight'
);

check(
  'settings port updates validate before save and rollback on failure',
  mainRs.includes('fn validate_port_settings_snapshot') &&
    coreRuntimeRs.includes('pub const RESERVED_MIXED_PORTS') &&
    coreRuntimeRs.includes('pub fn validate_runtime_ports') &&
    coreRuntimeRs.includes('pub fn mixed_port_from_value') &&
    mainRs.includes('core_runtime::validate_runtime_ports(settings.mixed_port, settings.controller_port)') &&
    mainRs.includes('core_runtime::mixed_port_from_value') &&
    mainRs.includes('core_runtime::port_from_value') &&
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
    mainRs.includes('fn stop_orphaned_core_processes') &&
    mainRs.includes('Interrupted managed core recovery failed:') &&
    coreRuntimeRs.includes('pub fn orphaned_core_cleanup_script') &&
    coreRuntimeRs.includes("Get-Process -Name {process_name_literal}") &&
    coreRuntimeRs.includes('Stop-Process -Id $_.Id -Force') &&
    !coreRuntimeRs.includes('Get-CimInstance Win32_Process -Filter "Name = {binary_literal}"') &&
    mainRs.includes('fn run_powershell_with_timeout') &&
    mainRs.includes('run_powershell_with_timeout(&script, Duration::from_secs(3))') &&
    mainRs.includes('self.restart_core_preserving_proxy(350)?') &&
    mainRs.includes('core.restart_core_preserving_proxy(350)') &&
    mainRs.includes('if let Err(err) = self.wait_for_controller()'),
  'core lifecycle transaction'
);

check(
  'subscription import/update validate before applying',
    subscriptionRuntimeRs.includes('pub(crate) struct ProfileSourceSummary') &&
    subscriptionRuntimeRs.includes('pub(crate) struct ProfileSource') &&
    subscriptionRuntimeRs.includes('pub(crate) fn summarize_source(') &&
    mainRs.includes('use subscription_runtime::ProfileSourceSummary;') &&
    subscriptionRuntimeRs.includes('pub(crate) fn parse_source_text(') &&
    subscriptionRuntimeRs.includes('pub(crate) fn download_source_url(') &&
    subscriptionRuntimeRs.includes('subscription download returned empty content') &&
    !mainRs.includes('fn summarize_profile_source') &&
    !mainRs.includes('fn download_profile_source_url_diagnostic') &&
    mainRs.includes('profile_compiler::compile_profile_source(source.config, &profile, &settings)') &&
    mainRs.includes('plan.source_deployment_candidate(&profile_dir, &path, "Subscription import")') &&
    mainRs.includes('plan.source_deployment_candidate(&profile_root, &profile_path, "Subscription update")') &&
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
  'subscription status snapshots never re-read broken profile files',
  publicProfileBody.includes('metadata_error: Option<&str>') &&
    publicProfileBody.includes('metadata_error.map(sanitize_sensitive_text)') &&
    !publicProfileBody.includes('profile_file_summary') &&
    !publicProfileBody.includes('fs::read_to_string') &&
    mainRs.includes('profile_metadata_errors: HashMap<String, String>') &&
    mainRs.includes('profile_metadata_errors: core.profile_metadata_errors.clone()') &&
    mainRs.includes('.profile_metadata_errors\n        .remove(&profile.id)') &&
    mainRs.includes('self.profile_metadata_errors.remove(id)'),
  'metadata repair reads once at startup; status, diagnostics, update, and delete use cached evidence'
);

check(
  'subscription import and update rollback on runtime failure',
  mainRs.includes('Profile import runtime apply failed; rolled back') &&
    mainRs.includes('Profile update runtime apply failed; restored previous subscription') &&
    mainRs.includes('ConfigDeploymentTransaction::stage(') &&
    mainRs.includes('"Subscription import"') &&
    mainRs.includes('"Subscription update"') &&
    mainRs.includes('deployment.rollback_with_runtime(') &&
    mainRs.includes('deployment.complete_verified(') &&
    mainRs.includes('combine_restore_results(') &&
    mainRs.includes('core.hot_reload_runtime_plan(&profile, &plan)') &&
    mainRs.includes('runtime hot reload completed in {} ms without core restart') &&
    configDeploymentRs.includes('pub fn promote(') &&
    configDeploymentRs.includes('pub fn rollback(') &&
    configDeploymentRs.includes('pub fn recover_interrupted_deployments(') &&
    mainRs.includes('Profile was removed before update completed') &&
    mainRs.includes('let rollback_plan = core_runtime::CoreRuntimeRestartPlan::preserving_proxy(') &&
    mainRs.includes('core.start_from_restart_plan(rollback_plan).map(|_| ())') &&
    !mainRs.includes('core.restore_system_proxy_preference(previous_system_proxy)'),
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
    mainRs.includes('CoreRuntimeApplyTransaction::new') &&
    mainRs.includes('apply_transaction.apply(&self.core_controller())') &&
    mainRs.includes('let mut receipt = result.receipt_json();') &&
    mainRs.includes('"applyElapsedMs".to_string()') &&
    mainRs.includes('"versionProbeCount".to_string(), json!(1)') &&
    mainRs.includes('let controller_ready = !was_running || reload.is_ok();') &&
    !mainRs.includes('let controller_ready = !was_running || self.core_controller().runtime_reuse_ready();') &&
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
    coreDomainRs.includes('pub struct ProxyCatalog') &&
    coreDomainRs.includes('pub fn apply_selected_map') &&
    coreRuntimeRs.includes('pub fn resolve_group_leaf') &&
    coreRuntimeRs.includes('pub fn shape_proxy_catalog_model') &&
    mainRs.includes('core_runtime::resolve_group_leaf(') &&
    mainRs.includes('core_runtime::shape_proxy_catalog_model(') &&
    !mainRs.includes('fn resolve_group_leaf') &&
    !mainRs.includes('fn apply_group_resolution_with_selected_map') &&
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
    mainRs.includes('mod config_domain') &&
    mainRs.includes('mod config_pipeline') &&
    configDomainRs.includes('pub struct ProfileCatalog') &&
    configDomainRs.includes('pub struct ManualNodeConfig') &&
    configPipelineRs.includes('pub(crate) fn compile_runtime_catalog') &&
    configPipelineRs.includes('pub(crate) fn patch_config') &&
    configPipelineRs.includes('pub(crate) fn patch_direct_profile') &&
    !configPipelineRs.includes('pub(crate) fn patch_profile_source') &&
    !configPipelineRs.includes('pub(crate) fn patch_and_preflight') &&
    !configPipelineRs.includes('pub(crate) fn preflight_profile_source') &&
    profileCompilerRs.includes('pub(crate) struct RuntimeDeploymentPlan') &&
    profileCompilerRs.includes('source_catalog: ProfileCatalog') &&
    profileCompilerRs.includes('runtime_catalog: ProfileCatalog') &&
    profileCompilerRs.includes('pub(crate) source_yaml: String') &&
    profileCompilerRs.includes('pub(crate) runtime_yaml: String') &&
    profileCompilerRs.includes('pub(crate) fn compile_profile_file') &&
    profileCompilerRs.includes('pub(crate) fn compile_profile_source') &&
    profileCompilerRs.includes('config_pipeline::compile_runtime_catalog(') &&
    !profileCompilerRs.includes('patch_config_with_settings') &&
    !profileCompilerRs.includes('preflight_runtime_config') &&
    profileCompilerRs.includes('source_digest: sha256_text(&source_yaml)') &&
    profileCompilerRs.includes('runtime_digest: sha256_text(&runtime_yaml)') &&
    mainRs.includes('fn render_runtime_profile_with_settings(') &&
    mainRs.includes('apply_aegos_user_rule_overlay(&self.app_data, profile, &mut source)?') &&
    mainRs.includes('profile_compiler::compile_profile_source(source, profile, settings)') &&
    mainRs.includes('profile_compiler::compile_profile_source(source.config, &profile, &settings)') &&
    mainRs.includes('self.hot_reload_runtime_plan(profile, &plan)') &&
    mainRs.includes('config_pipeline::patch_direct_profile(&self.settings)') &&
    !configPipelineRs.includes('pub(crate) fn patch_speed_test_source') &&
    !configPipelineRs.includes('pub(crate) fn speed_test_firewall_ports_from_source') &&
    !mainRs.includes('proxy_ports_from_config') &&
    !mainRs.slice(0, mainRs.indexOf('#[cfg(test)]')).includes('config_pipeline::patch_config(') &&
    !mainRs.includes('config_pipeline::patch_and_preflight(') &&
    !mainRs.includes('config_pipeline::preflight_config(') &&
    !mainRs.includes('fn patch_config_with_settings(') &&
    !mainRs.includes('config_pipeline::preflight_profile_source(') &&
    !mainRs.includes('config_pipeline::patch_profile_source(') &&
    !mainRs.includes('let patched = patch_config_with_settings(source, settings, Some(&profile.id))?') &&
    mainRs.includes('runtime_config_digest') &&
    mainRs.includes('Profile apply skipped; unchanged runtime config digest') &&
    mainRs.includes('core_runtime::runtime_config_unchanged_result_json(') &&
    coreRuntimeRs.includes('pub fn runtime_config_unchanged_result_json(') &&
    coreRuntimeRs.includes('"skipped": true') &&
    mainRs.includes('runtime_config_digest_is_stable_until_settings_change'),
  'digest-based config apply skip'
);

check(
  'core-changing operations use a shared operation queue',
  mainRs.includes('operations: runtime_command::RuntimeOperationCoordinator') &&
    mainRs.includes('mod runtime_command;') &&
    runtimeCommandRs.includes('pub struct RuntimeOperationCoordinator') &&
    runtimeCommandRs.includes('pub struct RuntimeOperationSnapshot') &&
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
  subscriptionRuntimeRs.includes('pub(crate) fn diagnostic(') &&
    subscriptionRuntimeRs.includes('pub(crate) fn download_source_url(') &&
    subscriptionRuntimeRs.includes('pub(crate) fn parse_uri_source(') &&
    subscriptionRuntimeRs.includes('"unsupported-format"') &&
    subscriptionRuntimeRs.includes('"unsupported-protocol"') &&
    mainRs.includes('"runtime-preflight"') &&
    !mainRs.includes('fn subscription_diagnostic(') &&
    mainRs.includes('subscription_diagnostics_classify_unsupported_protocols'),
  'download, format, protocol, and runtime preflight diagnostics'
);

check(
  'protocol capability matrix rejects core-unsupported proxy types',
  subscriptionRuntimeRs.includes('pub(crate) const AEGOS_URI_PROTOCOLS') &&
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
    return coreRuntimeRs.includes('pub struct ProxySelectionPreflight') &&
      coreRuntimeRs.includes('pub fn validate_proxy_selection_from_groups') &&
      coreRuntimeRs.includes('Node switch preflight failed') &&
      !mainRs.includes('fn validate_proxy_selection_from_groups') &&
      mainRs.includes('Node switch preflight passed') &&
      mainRs.includes('node_switch_preflight_validates_group_and_proxy') &&
      body.includes('let groups = self.proxy_groups();') &&
      body.includes('core_runtime::validate_proxy_selection_from_groups(&groups, group, proxy)?') &&
      body.includes('previous runtime node rollback also failed:') &&
      body.includes('Node preference save failed:') &&
      body.indexOf('apply_proxy_selection_with_cleanup(group, proxy)') < body.indexOf('selected_proxy_map\n            .insert');
  })(),
  'change_proxy validates current group/node snapshot first'
);

check(
  'connection closure is returned by connect and node switch jobs',
  mainRs.includes('fn connection_closure(&self) -> JsonValue') &&
    coreRuntimeRs.includes('pub fn connection_status_json(') &&
    coreRuntimeRs.includes('pub fn connection_closure_json(') &&
    coreRuntimeRs.includes('"coreRunning"') &&
    coreRuntimeRs.includes('"systemProxyApplied"') &&
    coreRuntimeRs.includes('"currentNode"') &&
    coreRuntimeRs.includes('"outboundIpKnown"') &&
    coreRuntimeRs.includes('connection_status_and_closure_are_runtime_shaped') &&
    mainRs.includes('core_runtime::connection_status_json(') &&
    mainRs.includes('core_runtime::connection_closure_json(') &&
    !mainRs.includes('fn connection_phase(&self)') &&
    connectionStatusSummaryBody.includes('core_runtime::connection_status_json(') &&
    connectionClosureBody.includes('core_runtime::connection_closure_json(') &&
    !connectionStatusSummaryBody.includes('"coreRunning"') &&
    !connectionStatusSummaryBody.includes('"systemProxyApplied"') &&
    !connectionClosureBody.includes('"currentNode".to_string()') &&
    !connectionClosureBody.includes('"outboundIpKnown".to_string()') &&
    mainRs.includes('core_runtime::core_start_result_json(') &&
    coreRuntimeRs.includes('"connection": connection') &&
    mainRs.includes('let connection = core.connection_closure();') &&
    mainRs.includes('json!({ "group": group, "proxy": proxy, "connection": connection })'),
  'core running, takeover, system proxy, node, and outbound IP closure'
);

check(
  'connection failures are classified for user-facing actions',
  coreRuntimeRs.includes('pub fn classify_failure_reason') &&
    ['timeout', 'dns', 'tls', 'auth', 'unsupported-protocol', 'port-conflict', 'controller-unavailable', 'config', 'network'].every((item) => coreRuntimeRs.includes(`"${item}"`)) &&
    coreRuntimeRs.includes('pub fn classified_error') &&
    coreRuntimeRs.includes('runtime_failure_reason_classifier_covers_common_connection_failures') &&
    mainRs.includes('core_runtime::classified_error("Node switch", apply_error)') &&
    !mainRs.includes('fn classify_failure_reason') &&
    !mainRs.includes('fn classified_error'),
  'timeout/DNS/TLS/auth/controller/config/network classifications'
);

check(
  'speed engine tracks node health and low-latency recommendations',
  speedRuntimeRs.includes('pub struct NodeHealth') &&
    mainRs.includes('fn update_node_health') &&
    speedRuntimeRs.includes('failure_streak') &&
    speedRuntimeRs.includes('cooldown_until') &&
    mainRs.includes('lowLatency') &&
    mainRs.includes('recommended') &&
    mainRs.includes('recommendation_requires_sub_100ms_available_node'),
  'node health, cooldown, and recommendation model'
);

check(
  'speed results expose confidence and freshness',
  speedRuntimeRs.includes('SPEED_RESULT_HIGH_CONFIDENCE_SECS') &&
    speedRuntimeRs.includes('pub fn speed_result_confidence') &&
    speedRuntimeRs.includes('pub fn speed_confidence_summary') &&
    mainRs.includes('"healthConfidence"') &&
    mainRs.includes('"resultAgeSecs"') &&
    speedRuntimeRs.includes('"recommendedFresh"') &&
    speedRuntimeRs.includes('confidence_tracks_fresh_stale_and_failed_results'),
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
    mainRs.includes('json!(self.recovery_suggestions(5))') &&
    coreRuntimeRs.includes('"suggestions": suggestions') &&
    coreRuntimeRs.includes('recovery_results_are_runtime_shaped') &&
    mainRs.includes('recovery_suggestions_rank_same_region_and_fresh_results'),
  'same-region suggestions require confirmation'
);

check(
  'node-level diagnostics link health, logs, and suggestions',
  mainRs.includes('fn node_diagnostics_from_snapshot') &&
    mainRs.includes('fn recent_node_logs_from_snapshot') &&
    mainRs.includes('fn log_matches_node') &&
    mainRs.includes('"lastFailure"') &&
    mainRs.includes('core_runtime::classify_failure_reason(&entry.line)') &&
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
