import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const tauri = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const capabilities = fs.readFileSync(path.join(root, 'src-tauri', 'capabilities', 'default.json'), 'utf8');
const releaseAudit = fs.readFileSync(path.join(root, 'tools', 'release-audit.js'), 'utf8');
const backendAudit = fs.readFileSync(path.join(root, 'tools', 'backend-audit.js'), 'utf8');
const speedAudit = fs.readFileSync(path.join(root, 'tools', 'speed-closure-audit.js'), 'utf8');
const takeoverAudit = fs.readFileSync(path.join(root, 'tools', 'system-takeover-audit.js'), 'utf8');
const interactionSmoke = fs.readFileSync(path.join(root, 'tools', 'interaction-smoke.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

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

const addLogBody = sliceBetween(mainRs, 'fn add_log', 'fn save_settings');
const publicProfileBody = sliceBetween(mainRs, 'fn public_profile', 'fn parse_uri_subscription');
const patchConfigBody = sliceBetween(mainRs, 'fn patch_config_with_settings', 'fn preflight_runtime_config');
const setSystemProxyBody = sliceBetween(mainRs, 'fn set_system_proxy', 'fn set_kill_switch');
const applyTakeoverBody = sliceBetween(mainRs, 'fn apply_takeover_after_core_ready', 'fn start(&mut self)');
const stopBody = sliceBetween(mainRs, 'fn stop(&mut self)', 'fn shutdown_for_exit');
const speedBody = sliceBetween(mainRs, 'fn start_proxy_delay_test', 'fn test_single_proxy_delay');
const singleSpeedBody = sliceBetween(mainRs, 'fn test_single_proxy_delay_for_run', 'fn probe_proxy_network');
const exportLogsBody = sliceBetween(mainRs, 'fn export_logs_from_state', 'fn controller_request');
const startBody = sliceBetween(mainRs, 'fn start_with_takeover', 'fn terminate_core_process');
const renderNodeBody = sliceBetween(appJs, 'function renderNodeRow', 'function renderHomeNodeRow');
const renderLogsBody = sliceBetween(appJs, 'function renderLogs', 'function setOutboundIpText');
const dangerousRenderApis = /\b(innerHTML\s*=|outerHTML\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(|eval\s*\(|new Function\s*\()/m;

check(
  'security audit script is exposed in package scripts',
  pkg.scripts?.['audit:security'] === 'node tools/security-hotfix-audit.js',
  'npm run audit:security'
);

check(
  'logs and public subscription metadata are sanitized',
  mainRs.includes('fn sanitize_sensitive_text') &&
    mainRs.includes('fn redact_after_key') &&
    mainRs.includes('fn redact_uri_userinfo') &&
    mainRs.includes('log_sanitizer_redacts_subscription_and_node_secrets') &&
    addLogBody.includes('sanitize_sensitive_text(line.as_ref())') &&
    startBody.includes('sanitize_sensitive_text(&line)') &&
    publicProfileBody.includes('sanitize_sensitive_text(value)') &&
    exportLogsBody.includes('entry.line.replace') &&
    mainRs.includes('export_logs_from_state(&state.logs, &state.app_data)') &&
    !publicProfileBody.includes('"source_url": &profile.source_url'),
  'subscription token/password/uuid/bearer/userinfo must not leak through logs or public profile JSON'
);

check(
  'Windows system proxy takeover is verified and restore failures are surfaced',
  mainRs.includes('fn verify_system_proxy_points_to_aegos') &&
    setSystemProxyBody.includes('verify_system_proxy_points_to_aegos(true)') &&
    setSystemProxyBody.includes('verify_system_proxy_points_to_aegos(false)') &&
    applyTakeoverBody.includes('system_proxy_applied') &&
    !applyTakeoverBody.includes('self.settings.system_proxy = true;') &&
    applyTakeoverBody.includes('self.traffic_takeover = self.settings.tun_enabled || system_proxy_applied') &&
    stopBody.includes('Core stopped, but Windows system proxy restore failed'),
  'connection state must reflect actual OS proxy/TUN takeover, not a hopeful flag'
);

check(
  'speed tests remain measurement-only and cannot auto-connect',
  speedBody.includes('ensure_core_for_delay_test') &&
    speedBody.includes('speed.recommended = speed_recommendation') &&
    singleSpeedBody.includes('speed.recommended') &&
    singleSpeedBody.includes('speed_recommendation(&targets_for_recommendation') &&
    !speedBody.includes('change_proxy') &&
    !speedBody.includes('select_best_proxy') &&
    !singleSpeedBody.includes('change_proxy') &&
    !singleSpeedBody.includes('select_best_proxy') &&
    speedAudit.includes('batch speed-test backend does not switch proxies') &&
    interactionSmoke.includes('speed test triggered a proxy switch') &&
    interactionSmoke.includes('batch speed test triggered a proxy switch'),
  'delay tests update health/recommendation only'
);

check(
  'disconnect protection speed-test firewall window is scoped and cleaned',
  speedBody.includes('build_speed_test_firewall_script(') &&
    speedBody.includes('cleanup_speed_firewall') &&
    mainRs.includes('kill-switch-speed-test-rules.marker') &&
    mainRs.includes('build_speed_test_firewall_script(') &&
    mainRs.includes('remoteport=$portList') &&
    backendAudit.includes('disconnect protection allows speed tests without disabling protection') &&
    takeoverAudit.includes('speed tests can run under disconnect protection through scoped temporary allow rules'),
  'temporary firewall rules must not outlive speed tests'
);

check(
  'controller and LAN exposure remain locked down by default',
  patchConfigBody.includes('"external-controller"') &&
    patchConfigBody.includes('127.0.0.1:{}') &&
    patchConfigBody.includes('"bind-address"') &&
    patchConfigBody.includes('settings.allow_lan { "*" } else { "127.0.0.1" }') &&
    mainRs.includes('allow_lan: false') &&
    mainRs.includes('secret: hex_random(24)') &&
    releaseAudit.includes('Aegos defaults avoid FlClash/Codex port 7890'),
  'controller must bind locally, allow-lan must be opt-in, and secret must be generated'
);

check(
  'WebView2 missing runtime is handled by the installer',
  tauri.bundle?.windows?.webviewInstallMode?.type === 'downloadBootstrapper' &&
    tauri.bundle?.windows?.webviewInstallMode?.silent === false &&
    releaseAudit.includes('WebView2 missing runtime is handled by installer'),
  JSON.stringify(tauri.bundle?.windows?.webviewInstallMode)
);

check(
  'Tauri ACL remains minimal for the current desktop surface',
  capabilities.includes('core:window:allow-start-dragging') &&
    !capabilities.includes('shell:') &&
    !capabilities.includes('fs:') &&
    !capabilities.includes('http:') &&
    !capabilities.includes('process:') &&
    releaseAudit.includes('native window drag ACL is explicit and non-duplicated'),
  'no broad shell/fs/http/process capability should be added for these hotfixes'
);

check(
  'UI renders dynamic user/core text through safe DOM APIs',
  appJs.includes('function text(value') &&
    appJs.includes('function el(tag') &&
    appJs.includes('function replaceChildrenSafe') &&
    renderNodeBody.includes('text(name)') &&
    appJs.includes('function nodeAddressInfo') &&
    renderNodeBody.includes('textContent: address.label') &&
    renderNodeBody.includes('attrs: { title: address.title }') &&
    renderLogsBody.includes('textContent: entry.line') &&
    appJs.includes('textContent: item.detail') &&
    appJs.includes('emptyState(`\\u8bca\\u65ad\\u5931\\u8d25') &&
    !dangerousRenderApis.test(appJs),
  'dynamic node/log/diagnostic text must go through textContent/text nodes, with dangerous DOM APIs banned'
);

check(
  'subscription and runtime preflight still guard malformed profiles',
  mainRs.includes('parse_profile_source_text_diagnostic') &&
    mainRs.includes('download_profile_source_url_diagnostic') &&
    mainRs.includes('preflight_runtime_config(&patched') &&
    mainRs.includes('Profile switch failed and rolled back') &&
    backendAudit.includes('subscription import/update validate before applying') &&
    backendAudit.includes('profile switch validates, hot-reloads, and rolls back on failure'),
  'bad subscription/profile data must not replace the current working runtime'
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
