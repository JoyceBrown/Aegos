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
const appJs = read('src/app.js');
const stylesCss = read('src/styles.css');
const releaseAudit = read('tools/release-audit.js');
const commandStart = mainRs.indexOf('fn ipv6_dns_safety_snapshot');
const commandEnd = mainRs.indexOf('#[tauri::command]', commandStart + 1);
const commandBody = commandStart >= 0 ? mainRs.slice(commandStart, commandEnd > commandStart ? commandEnd : undefined) : '';

check('package version is in 3.4 IPv6/DNS lane or later 3.x', /^3\.(?:3|4|5|6)\.\d+$/.test(pkg.version), pkg.version);
check('IPv6/DNS safety audit is exposed', pkg.scripts?.['audit:ipv6-dns-safety'] === 'node tools/ipv6-dns-safety-audit.js', 'package.json');
check('3.4.1 local IPv6 capability is detected', mainRs.includes('fn local_ipv6_capability') && mainRs.includes('udp-route-probe') && mainRs.includes('2606:4700:4700::1111'), 'local IPv6');
check('3.4.2 current-node IPv4 outlet check exists', mainRs.includes('fn query_outbound_ip_family') && mainRs.includes('currentNodeIpv4') && mainRs.includes('https://api.ipify.org'), 'IPv4 outlet');
check('3.4.3 current-node IPv6 outlet check exists', mainRs.includes('currentNodeIpv6') && mainRs.includes('https://api6.ipify.org') && mainRs.includes('v6.ident.me'), 'IPv6 outlet');
check('3.4.4 node IPv6 support is classified', mainRs.includes('nodeIpv6Support') && mainRs.includes('"supported"') && mainRs.includes('"unsupported"'), 'node IPv6 support');
check('3.4.5 IPv6 leak detection is separated from unsupported node', mainRs.includes('"ipv6Leak"') && mainRs.includes('"blockedOrFallback"') && mainRs.includes('"risk"'), 'IPv6 leak');
check('3.4.6 DNS leak detection is classified', mainRs.includes('"dnsLeak"') && mainRs.includes('config_pipeline::runtime_dns_safety_report') && configPipelineRs.includes('AEGOS_DNS_LISTEN'), 'DNS leak');
check('3.4.7 user-facing IPv6 mode is automatic', mainRs.includes('"mode": "auto"') && appJs.includes('ipv6AutoModeState') && (appJs.includes('IPv6 模式') || appJs.includes('IPv6 \\u6a21\\u5f0f')) && appJs.includes('ipv6Toggle').valueOf(), 'auto mode');
check('3.4.8 unsupported IPv6 falls back or blocks safely', mainRs.includes('"fallback-ipv4"') && mainRs.includes('"block-ipv6-leak"') && mainRs.includes('ipv6_dns_safety_auto_falls_back_without_connection_changes'), 'fallback/block');
check('3.4.9 plain user prompt exists', mainRs.includes('"plainPrompt"') && appJs.includes('ipv6PlainPrompt'), 'plain prompt');
check('3.4.10 command is read-only and registered', mainRs.includes('fn ipv6_dns_safety_snapshot') && mainRs.includes('ipv6_dns_safety_snapshot,') && mainRs.includes('"changesConnection": false') && !commandBody.includes('patch_config_with_settings(source, &settings, Some(&profile.id))?;\\n            atomic_write') && !commandBody.includes('set_active_profile') && !commandBody.includes('select_best_proxy'), 'read-only command');
check(
  'frontend renders compact safety status without blocking navigation',
  appJs.includes('function refreshIpv6DnsSafety') &&
    appJs.includes("invoke('ipv6_dns_safety_snapshot'") &&
    appJs.includes("if (page === 'settings')") &&
    appJs.includes('refreshIpv6DnsSafety();') &&
    appJs.includes('if (ipv6DnsSafetyBusy) return;') &&
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
