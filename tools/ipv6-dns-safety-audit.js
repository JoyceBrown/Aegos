import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = [];
const pass = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok: Boolean(ok), detail });
}

const pkg = readJson('package.json');
const mainRs = read('src-tauri/src/main.rs');
const configPipelineRs = read('src-tauri/src/config_pipeline.rs');
const dnsPolicyRs = read('src-tauri/src/dns_policy.rs');
const ipv6PolicyRs = read('src-tauri/src/ipv6_policy.rs');
const appJs = read('src/app.js');
const stylesCss = read('src/styles.css');
const releaseAudit = read('tools/release-audit.js');
const commandStart = ipv6PolicyRs.indexOf('fn ipv6_dns_safety_snapshot');
const commandEnd = ipv6PolicyRs.indexOf('#[cfg(test)]', commandStart + 1);
const commandBody = commandStart >= 0 ? ipv6PolicyRs.slice(commandStart, commandEnd > commandStart ? commandEnd : undefined) : '';

check('package version is in 3.4 IPv6/DNS lane or later 3.x', /^3\.(?:3|4|5|6)\.\d+$/.test(pkg.version), pkg.version);
check('IPv6/DNS safety audit is exposed', pkg.scripts?.['audit:ipv6-dns-safety'] === 'node tools/ipv6-dns-safety-audit.js', 'package.json');
check('3.4.1 local IPv6 capability is detected', ipv6PolicyRs.includes('fn local_capability') && ipv6PolicyRs.includes('udp-route-probe') && ipv6PolicyRs.includes('2606:4700:4700::1111'), 'local IPv6');
check('3.4.2 current-node IPv4 outlet check exists', mainRs.includes('fn query_outbound_ip_family') && ipv6PolicyRs.includes('currentNodeIpv4') && mainRs.includes('https://api.ipify.org'), 'IPv4 outlet');
check('3.4.3 current-node IPv6 outlet check exists', ipv6PolicyRs.includes('currentNodeIpv6') && mainRs.includes('https://api6.ipify.org') && mainRs.includes('v6.ident.me'), 'IPv6 outlet');
check('3.4.4 node IPv6 support is classified', ipv6PolicyRs.includes('nodeIpv6Support') && ipv6PolicyRs.includes('"supported"') && ipv6PolicyRs.includes('"unsupported"'), 'node IPv6 support');
check('3.4.5 IPv6 leak detection is separated from unsupported node', ipv6PolicyRs.includes('"ipv6Leak"') && ipv6PolicyRs.includes('"blockedOrFallback"') && ipv6PolicyRs.includes('"risk"'), 'IPv6 leak');
check('3.4.6 DNS leak detection is classified', ipv6PolicyRs.includes('"dnsLeak"') && ipv6PolicyRs.includes('config_pipeline::runtime_dns_safety_report') && configPipelineRs.includes('AEGOS_DNS_LISTEN'), 'DNS leak');
check(
  '3.4.7 request, capability, runtime config, and effective IPv6 state are separate',
  ipv6PolicyRs.includes('"requested"') &&
    ipv6PolicyRs.includes('"localCapability"') &&
    ipv6PolicyRs.includes('"nodeCapability"') &&
    ipv6PolicyRs.includes('"runtimeConfig"') &&
    ipv6PolicyRs.includes('"effective"') &&
    appJs.includes('ipv6RequestedState') &&
    appJs.includes('ipv6EffectiveState'),
  'state contract'
);
check('3.4.8 unsupported IPv6 falls back or blocks safely', ipv6PolicyRs.includes('"fallback-ipv4"') && ipv6PolicyRs.includes('"block-ipv6-leak"') && ipv6PolicyRs.includes('unsupported_node_falls_back_without_changing_connection'), 'fallback/block');
check('3.4.9 plain user prompt exists', ipv6PolicyRs.includes('"plainPrompt"') && appJs.includes('ipv6PlainPrompt'), 'plain prompt');
check('3.4.10 command is read-only and registered', ipv6PolicyRs.includes('fn ipv6_dns_safety_snapshot') && mainRs.includes('ipv6_policy::ipv6_dns_safety_snapshot,') && ipv6PolicyRs.includes('"changesConnection": false') && !commandBody.includes('patch_config_with_settings') && !commandBody.includes('set_active_profile') && !commandBody.includes('select_best_proxy'), 'read-only command');
check(
  'IPv6 operation unlocks only after verified support while an enabled request can always be disabled',
  ipv6PolicyRs.includes('let can_change_requested = requested || (running && local_available && ipv6_ok)') &&
    appJs.includes('toggle.disabled = !data.canChangeRequested') &&
    appJs.includes("updateSetting('ipv6Enabled'"),
  'capability gate'
);
check(
  'DNS and IPv6 settings reapply the managed runtime and share settings rollback',
  mainRs.includes('fn setting_requires_runtime_restart') &&
    mainRs.includes('"dnsMode"') &&
    mainRs.includes('"dnsCustomNameservers"') &&
    mainRs.includes('"ipv6Enabled"') &&
    mainRs.includes('fn rollback_settings_after_failure') &&
    mainRs.includes('dns_and_ipv6_changes_require_managed_runtime_reapply'),
  'transaction linkage'
);
check(
  'slow DNS and IPv6 snapshots reject stale results and queue a current refresh',
  appJs.includes('let dnsPolicySeq = 0') &&
    appJs.includes('let ipv6DnsSafetySeq = 0') &&
    appJs.includes('requestSeq !== dnsPolicySeq') &&
    appJs.includes('requestSeq !== ipv6DnsSafetySeq') &&
    appJs.includes('ipv6DnsSafetyQueued') &&
    appJs.includes('dnsPolicyQueued'),
  'stale-result guard'
);
check(
  'DNS mode candidate and runtime snapshot have one focused owner',
  dnsPolicyRs.includes('pub(super) fn apply_candidate_value') &&
    dnsPolicyRs.includes('pub(super) fn validate_candidate') &&
    dnsPolicyRs.includes('pub(super) fn from_runtime_config') &&
    !mainRs.includes('fn apply_dns_candidate_value') &&
    !mainRs.includes('fn validate_dns_candidate') &&
    !mainRs.includes('fn dns_custom_nameservers_from_value'),
  'dns_policy.rs'
);
check(
  'DNS mode contract separates request, effective behavior, protection, and lock state',
  dnsPolicyRs.includes('"requestedMode"') &&
    dnsPolicyRs.includes('"effectiveMode"') &&
    dnsPolicyRs.includes('"protectionState"') &&
    dnsPolicyRs.includes('"hijackLocked"') &&
    dnsPolicyRs.includes('"needs-tun"') &&
    appJs.includes('policy.requestedMode') &&
    appJs.includes('policy.protectionState') &&
    appJs.includes('policy.hijackLocked'),
  'runtime contract and UI'
);
check(
  'invalid custom resolver errors identify position without echoing the value',
  dnsPolicyRs.includes('Custom DNS resolver {}') &&
    dnsPolicyRs.includes('custom_resolver_validation_does_not_echo_sensitive_input') &&
    !dnsPolicyRs.includes('cannot be local: {resolver}'),
  'redacted validation'
);
check(
  'system DNS and TUN conflict is explained before apply',
  appJs.includes('systemOption.disabled = tunEnabled') &&
    appJs.includes("const conflict = mode === 'system' && tunEnabled") &&
    appJs.includes('不能与 TUN'),
  'settings pre-apply guard'
);
check(
  'frontend renders compact safety status without blocking navigation',
  appJs.includes('function refreshIpv6DnsSafety') &&
    appJs.includes("invoke('ipv6_dns_safety_snapshot'") &&
    appJs.includes("if (page === 'settings')") &&
    appJs.includes('refreshIpv6DnsSafety();') &&
    appJs.includes('if (ipv6DnsSafetyBusy) {') &&
    appJs.includes('ipv6DnsSafetyQueued = true') &&
    stylesCss.includes('.ipv6-safety-card'),
  'frontend safety card'
);
check('release audit knows IPv6/DNS safety audit exists', releaseAudit.includes('IPv6/DNS safety audit script exists'), 'release-audit');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
