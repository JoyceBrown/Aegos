import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');

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

check(
  'status snapshot avoids controller version probe',
  !statusBody.includes('"/version"') && statusBody.includes('"version": JsonValue::Null'),
  'app_status should stay lightweight'
);
check(
  'status traffic timeout stays short',
  statusBody.includes('traffic_snapshot(120)') && !statusBody.includes('traffic_snapshot(450)'),
  'traffic snapshot timeout'
);
check(
  'speed tests run in background thread',
  mainRs.includes('fn start_proxy_delay_test') && mainRs.includes('thread::spawn(move ||') && mainRs.includes('speed_test_snapshot'),
  'background delay test'
);
check(
  'speed tests use standby core without traffic takeover or proxy switching',
  mainRs.includes('fn start_standby') &&
    mainRs.includes('fn ensure_core_for_delay_test') &&
    speedTestBody.includes('ensure_core_for_delay_test') &&
    mainRs.includes('Speed test starting mihomo in standby without traffic takeover') &&
    mainRs.includes('settings.tun_enabled = false') &&
    mainRs.includes('"trafficTakeover"') &&
    !speedTestBody.includes('change_proxy') &&
    !speedTestBody.includes('select_best_proxy'),
  'delay test may prepare a standby controller but remains measurement-only'
);
check(
  'disconnect protection allows speed tests without disabling protection',
  mainRs.includes('fn refresh_kill_switch_rules_if_enabled') &&
    mainRs.includes('fn build_speed_test_firewall_script') &&
    mainRs.includes('fn speed_test_firewall_ports') &&
    mainRs.includes('fn set_speed_test_firewall_rules') &&
    mainRs.includes('Disconnect protection allow rules refreshed for {reason}') &&
    mainRs.includes('Speed test firewall window opened for ports') &&
    mainRs.includes('service=Dnscache protocol=UDP remoteport=53') &&
    mainRs.includes('service=Dnscache protocol=TCP remoteport=53') &&
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
    mainRs.includes('配置生成失败') &&
    mainRs.includes('核心进程启动失败') &&
    mainRs.includes('控制接口未在 6 秒内就绪'),
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
    mainRs.includes('let admin_required = self.settings.tun_enabled || self.settings.kill_switch_enabled') &&
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
    mainRs.includes('订阅没有可用 proxies 节点') &&
    mainRs.includes('代理组引用了不存在的节点') &&
    mainRs.includes('mixed-port 应为') &&
    mainRs.includes('YAML 解析失败') &&
    mainRs.includes('Config preflight passed'),
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
    mainRs.includes('Stopping failed mihomo startup') &&
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
    mainRs.includes('preflight_runtime_config(&patched, &profile, &settings).map_err') &&
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
    mainRs.includes('let temp_path = profile_path.with_file_name') &&
    mainRs.includes('Profile was removed before update completed') &&
    mainRs.includes('core.restore_system_proxy_preference(previous_system_proxy)'),
  'subscription file/runtime transaction'
);

check(
  'profile switch validates, hot-reloads, and rolls back on failure',
  mainRs.includes('fn preflight_profile_file') &&
    mainRs.includes('fn hot_reload_profile') &&
    mainRs.includes('fn write_runtime_profile_copy') &&
    mainRs.includes('proxy_group_name_set') &&
    mainRs.includes('/configs?force=true') &&
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
    mainRs.includes('fn apply_group_resolution') &&
    mainRs.includes('realProxyName') &&
    mainRs.includes('proxy_items') &&
    mainRs.includes('profile_proxy_groups') &&
    mainRs.includes('.selected_proxy_map') &&
    mainRs.includes('insert(group.to_string(), proxy.to_string())'),
  'FlClash-style selected map and group resolution'
);

check(
  'profile apply uses digest no-op strategy',
  mainRs.includes('fn sha256_text') &&
    mainRs.includes('struct RenderedProfile') &&
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
    mainRs.includes('change_proxy command'),
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
    mainRs.includes('const MIHOMO_PROXY_TYPES') &&
    mainRs.includes('fn mihomo_supports_proxy_type') &&
    mainRs.includes('fn protocol_capability_summary') &&
    mainRs.includes('unsupported_proxy_types') &&
    mainRs.includes('Config preflight failed: unsupported proxy type(s)') &&
    mainRs.includes('preflight_rejects_core_unsupported_proxy_type') &&
    mainRs.includes('manual_hy2_node_is_normalized_to_hysteria2'),
  'parser/core/manual protocol support stays explicit'
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
  'best proxy selection is routed through background jobs',
  mainRs.includes('fn select_best_proxy') &&
    mainRs.includes('"selectBestProxy"') &&
    mainRs.includes('latency<100ms') &&
    mainRs.includes('lock_operation_queue(&operations, "selectBestProxy")'),
  'best proxy operation queue'
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
