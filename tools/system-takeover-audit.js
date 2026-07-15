import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
const coreRuntimeRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'core_runtime.rs'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const interactionSmoke = fs.readFileSync(path.join(root, 'tools', 'interaction-smoke.js'), 'utf8');
const backendAudit = fs.readFileSync(path.join(root, 'tools', 'backend-audit.js'), 'utf8');
const releaseAudit = fs.readFileSync(path.join(root, 'tools', 'release-audit.js'), 'utf8');
const speedAudit = fs.readFileSync(path.join(root, 'tools', 'speed-closure-audit.js'), 'utf8');

const fail = [];
const pass = [];

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

function sliceBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return start >= 0 && end > start ? source.slice(start, end) : '';
}

const proxyScriptBody = sliceBetween(mainRs, 'fn build_proxy_script', 'fn build_kill_switch_script');
const killScriptBody = sliceBetween(mainRs, 'fn build_kill_switch_script', 'fn build_speed_test_firewall_script');
const speedFirewallBody = sliceBetween(mainRs, 'fn build_speed_test_firewall_script', 'impl CoreManager');
const setSystemProxyBody = sliceBetween(mainRs, 'fn set_system_proxy', 'fn set_kill_switch');
const settingsUpdateBody = sliceBetween(mainRs, 'fn update_settings', 'fn set_mode');
const settingsRollbackBody = sliceBetween(mainRs, 'fn rollback_settings_after_failure', 'fn active_profile');
const lifecycleBody = sliceBetween(mainRs, 'fn start_with_takeover', 'fn terminate_core_process');
const diagnosticsBody = sliceBetween(mainRs, 'fn diagnostics_from_snapshot', 'fn diagnostics_detached');

check(
  'Windows proxy takeover snapshots and restores previous state',
  coreRuntimeRs.includes('pub struct SystemProxySnapshot') &&
    coreRuntimeRs.includes('pub fn system_proxy_snapshot_points_to_aegos') &&
    coreRuntimeRs.includes('pub fn should_capture_system_proxy_snapshot') &&
    coreRuntimeRs.includes('pub fn verify_system_proxy_snapshot') &&
    coreRuntimeRs.includes('pub struct CoreSystemProxyTakeoverPlan') &&
    coreRuntimeRs.includes('pub const WINDOWS_PROXY_BYPASS_LIST') &&
    coreRuntimeRs.includes('system_proxy_verification_is_owned_by_runtime_boundary') &&
    coreRuntimeRs.includes('system_proxy_takeover_plan_is_owned_by_runtime_boundary') &&
    coreRuntimeRs.includes('system_proxy_snapshot_policy_is_owned_by_runtime_boundary') &&
    !mainRs.includes('struct SystemProxySnapshot') &&
    mainRs.includes('CoreSystemProxyTakeoverPlan::new') &&
    mainRs.includes('fn read_windows_proxy_snapshot') &&
    mainRs.includes('fn write_windows_proxy_snapshot') &&
    mainRs.includes('fn capture_proxy_snapshot_before_takeover') &&
    mainRs.includes('fn verify_system_proxy_points_to_aegos') &&
    mainRs.includes('core_runtime::verify_system_proxy_snapshot') &&
    mainRs.includes('fn load_system_proxy_snapshot') &&
    mainRs.includes('fn clear_system_proxy_snapshot') &&
    mainRs.includes('fn shutdown_for_exit') &&
    proxyScriptBody.includes('InternetSetOption') &&
    lifecycleBody.includes('self.restore_system_proxy_preference(restart_plan.restore_system_proxy)') &&
    setSystemProxyBody.includes('verify_system_proxy_points_to_aegos(true)') &&
    setSystemProxyBody.includes('verify_system_proxy_points_to_aegos(false)'),
  'Aegos must be able to leave Windows proxy as it found it'
);

check(
  'manual system proxy preference does not auto-connect traffic takeover',
  setSystemProxyBody.includes('if enable && !self.traffic_takeover') &&
    setSystemProxyBody.includes('System proxy preference enabled; connect before applying Windows proxy takeover') &&
    appJs.includes("updateSetting('systemProxy'") &&
    interactionSmoke.includes('manual system proxy toggle auto-connected traffic takeover') &&
    releaseAudit.includes('manual system proxy toggle does not auto-connect'),
  'turning on the preference is not the same as connecting'
);

check(
  'disconnect protection uses verified firewall transaction and no invalid group argument',
  killScriptBody.includes('Disconnect protection requires administrator permission') &&
    killScriptBody.includes('Invoke-AegosNetsh') &&
    killScriptBody.includes('DefaultOutboundAction Block') &&
    killScriptBody.includes('Disconnect protection did not create Aegos allow rules') &&
    killScriptBody.includes('Disconnect protection enable failed') &&
    killScriptBody.includes('Disconnect protection rules were not fully removed') &&
    !killScriptBody.includes('"group=$group"') &&
    releaseAudit.includes('disconnect protection verifies firewall state'),
  'firewall changes must verify and roll back when Windows rejects them'
);

check(
  'speed tests can run under disconnect protection through scoped temporary allow rules',
    speedFirewallBody.includes('Speed test firewall rules require administrator permission') &&
    coreRuntimeRs.includes('FIREWALL_SPEED_TEST_MARKER_FILE') &&
    mainRs.includes('CoreFirewallPolicyPlan::speed_test') &&
    speedFirewallBody.includes('remoteport=$portList') &&
    mainRs.includes('cleanup_speed_firewall') &&
    speedAudit.includes('disconnect protection speed-test allow rules open and clean up inside worker') &&
    backendAudit.includes('disconnect protection allows speed tests without disabling protection'),
  '测速 should not require disabling protection or blocking the UI'
);

check(
  'port conflict prevention and diagnostics are both wired',
  coreRuntimeRs.includes('pub const RESERVED_MIXED_PORTS') &&
    coreRuntimeRs.includes('pub fn validate_runtime_ports') &&
    mainRs.includes('AEGOS_DEFAULT_MIXED_PORT: u16 = 7891') &&
    mainRs.includes('fn validate_port_settings_snapshot') &&
    mainRs.includes('core_runtime::validate_runtime_ports(settings.mixed_port, settings.controller_port)') &&
    diagnosticsBody.includes('"Mixed port availability"') &&
    diagnosticsBody.includes('"Controller port availability"') &&
    diagnosticsBody.includes('port_owner_detail(snapshot.settings.mixed_port)') &&
    releaseAudit.includes('settings save rejects proxy port conflicts'),
  'avoid FlClash/Codex 7890 and explain occupied ports'
);

check(
  'settings updates validate before save and roll back after failed side effects',
    settingsUpdateBody.includes('self.validate_settings_update_candidate(map)?') &&
    settingsUpdateBody.includes('previous_settings') &&
    settingsUpdateBody.includes('rollback_settings_after_failure') &&
    settingsRollbackBody.includes('settings rolled back') &&
    backendAudit.includes('settings port updates validate before save and rollback on failure'),
  'bad TUN/protection/proxy changes must not leave half-applied settings'
);

check(
  'recovery and repair are exposed as non-blocking jobs',
  appJs.includes('function repairSystemProxyJob') &&
    appJs.includes("runBackgroundJob('repairSystemProxy'") &&
    appJs.includes("runBackgroundJob('recoverNetwork'") &&
    mainRs.includes('"repairSystemProxy" =>') &&
    mainRs.includes('"recoverNetwork" =>') &&
    interactionSmoke.includes('repairSystemProxy') &&
    releaseAudit.includes('system proxy takeover restores previous Windows proxy'),
  'users need a repair path when the OS proxy is abnormal'
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
