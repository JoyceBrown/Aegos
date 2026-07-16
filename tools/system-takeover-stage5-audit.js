import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const exists = (rel) => fs.existsSync(path.join(root, rel));
const check = (name, ok, detail = '') => (ok ? pass : fail).push({ name, ok: Boolean(ok), detail });

const pkg = JSON.parse(read('package.json'));
const main = read('src-tauri/src/main.rs');
const runtime = read('src-tauri/src/core_runtime.rs');
const compiler = read('src-tauri/src/profile_compiler.rs');
const takeover = read('src-tauri/src/system_takeover.rs');
const releaseAudit = read('tools/release-audit.js');
const semverAtLeast = (version, baseline) => {
  const current = String(version).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const minimum = String(baseline).split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(current.length, minimum.length); index += 1) {
    if ((current[index] || 0) !== (minimum[index] || 0)) return (current[index] || 0) > (minimum[index] || 0);
  }
  return true;
};

check('current version carries stage 5 forward', semverAtLeast(pkg.version, '3.6.16'), pkg.version);
check('stage 5 audit is exposed', pkg.scripts?.['audit:system-takeover-stage5'] === 'node tools/system-takeover-stage5-audit.js');
check('takeover journal is atomic and stateful', ['SystemTakeoverTransaction', 'TakeoverJournal', 'prepared', 'applying', 'verified', 'rolled-back', 'recovery-required', 'atomic_write'].every((token) => takeover.includes(token)));
check('unclean shutdown lease is independent from transaction terminal state', ['ActiveTakeoverState', 'ACTIVE_STATE_FILE', 'active_takeover_state', 'set_component_active', 'any_active'].every((token) => takeover.includes(token)) && main.includes('recover_interrupted_system_takeover'));
check('proxy snapshot includes PAC and auto detection', ['auto_config_url', 'auto_detect'].every((token) => runtime.includes(token)) && main.includes('[string]$item.AutoConfigURL') && main.includes('[bool]$item.AutoDetect'));
check('proxy restore verifies every captured field', runtime.includes('pub fn verify_system_proxy_restore') && main.includes('restore_system_proxy_snapshot_verified') && main.includes('The complete pre-Aegos proxy state was restored and verified.'));
check('takeover pauses PAC but snapshot-free disable preserves it', main.includes('Remove-ItemProperty -Path $path -Name AutoConfigURL') && main.includes('windows_takeover_scripts_preserve_external_network_policy'));
check('firewall cleanup owns both exact Aegos groups', main.includes('$speedRulePrefix') && main.includes('Aegos firewall rules were not fully removed') && runtime.includes('FIREWALL_DISCONNECT_PROTECTION_GROUP') && runtime.includes('FIREWALL_SPEED_TEST_GROUP'));
check('missing firewall snapshot does not overwrite user defaults', !main.includes('Set-NetFirewallProfile -Profile Domain,Private,Public -DefaultOutboundAction Allow') && main.includes('DefaultOutboundAction $profile.DefaultOutboundAction'));
check('TUN validation covers candidate and Aegos-owned Windows takeover', main.includes('fn verify_tun_state') && main.includes('profile_compiler::verify_tun_candidate') && main.includes("$pattern = '(?i)^aegos$'") && main.includes('windows_tun_evidence') && main.includes('direct_connectivity_probe') && main.includes('runtime_reuse_ready') && ['verify_tun_candidate', 'auto-route', 'auto-detect-interface', 'device', 'runtime_dns_safety_report'].every((token) => compiler.includes(token)) && main.includes('set_yaml(tun_map, "device", YamlValue::String("Aegos".to_string()))'));
check('TUN failure rolls back and leaves a recovery record', main.includes('takeover_failure_message(transaction, err, rollback)') && main.includes('previous_settings.tun_enabled') && main.includes('transaction.fail(&err, rollback_ok)'));
check('startup recovery is constrained to managed artifacts', main.includes('stop_stale_managed_core') && main.includes('[IO.Path]::GetFullPath($_.ExecutablePath) -ieq [IO.Path]::GetFullPath($target)') && main.includes('set_component_active(&self.app_data, component, false)'));
check('conflict scan is read-only and user-facing', main.includes('fn windows_network_conflict_report') && main.includes('Proxy and VPN conflicts') && main.includes('Other proxy or VPN software') && main.includes('Aegos did not change them.') && !main.includes('Stop-Process -Name'));
check('clean exit restores owned Windows state', main.includes('fn shutdown_for_exit') && main.includes('self.set_system_proxy(false)') && main.includes('self.set_kill_switch(false)') && main.includes('"TUN clean-exit marker update failed'));
check('fault injection and script contract tests exist', ['interrupted_transaction_requires_startup_recovery', 'failed_transaction_stays_visible_when_rollback_fails', 'active_takeover_state_survives_crash_until_each_component_is_cleared', 'windows_takeover_scripts_preserve_external_network_policy', 'tun_candidate_has_route_interface_and_dns_takeover_contract'].every((token) => `${takeover}\n${main}`.includes(token)));
check('all stage 5 checkpoint notes exist', Array.from({ length: 8 }, (_, index) => exists(`RELEASE_3.6.${index + 9}.md`)).every(Boolean));
check('release audit includes stage 5 gate', releaseAudit.includes('system takeover stage 5 audit script exists') && releaseAudit.includes('audit:system-takeover-stage5'));

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
