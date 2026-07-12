import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const backendAudit = fs.readFileSync(path.join(root, 'tools', 'backend-audit.js'), 'utf8');
const interactionSmoke = fs.readFileSync(path.join(root, 'tools', 'interaction-smoke.js'), 'utf8');
const releaseAudit = fs.readFileSync(path.join(root, 'tools', 'release-audit.js'), 'utf8');

const fail = [];
const pass = [];

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

function bodyBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return start >= 0 && end > start ? source.slice(start, end) : '';
}

const testNodesBody = appJs.match(/async function testNodes\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] || '';
const speedBody = bodyBetween(mainRs, 'fn start_proxy_delay_test', 'fn test_single_proxy_delay');
const singleBody = bodyBetween(mainRs, 'fn test_single_proxy_delay', 'fn test_proxy_delays');
const ensureBody = bodyBetween(mainRs, 'fn ensure_core_for_delay_test', 'fn start_proxy_delay_test');
const profileSwitchBody = bodyBetween(mainRs, 'fn set_active_profile', 'fn rename_profile');

check(
  'batch speed tests start only the delay-test command from UI',
  testNodesBody.includes("invoke('start_proxy_delay_test'") &&
    !testNodesBody.includes("runBackgroundJob('changeProxy'") &&
    !testNodesBody.includes("runBackgroundJob('selectBestProxy'") &&
    !testNodesBody.includes('selectBestProxyJob'),
  'UI speed action is measurement-only'
);

check(
  'batch speed-test backend does not switch proxies',
  speedBody.includes('ensure_core_for_delay_test') &&
    speedBody.includes('speed.delays') &&
    speedBody.includes('speed.recommended = speed_recommendation') &&
    !speedBody.includes('change_proxy') &&
    !speedBody.includes('select_best_proxy'),
  'backend updates delay, health, recommendation only'
);

check(
  'single-node speed test does not switch proxies',
  singleBody.includes('test_proxy_delay_with_retry') &&
    singleBody.includes('speed.delays.insert') &&
    singleBody.includes('speed.recommended = speed_recommendation') &&
    !singleBody.includes('change_proxy') &&
    !singleBody.includes('select_best_proxy'),
  'single test only updates one node health'
);

check(
  'batch speed test uses fast pass only while single-node keeps deep retry',
  speedBody.includes('test_proxy_delay_fast') &&
    !speedBody.includes('test_proxy_delay_with_retry') &&
    singleBody.includes('test_proxy_delay_with_retry') &&
    mainRs.includes('fn test_proxy_delay_fast'),
  'batch speed should return quickly; single node can probe deeper'
);

check(
  'profile switching cancels stale speed tests and clears visible speed state',
  mainRs.includes('run_id: u64') &&
    mainRs.includes('"runId": speed.run_id') &&
    profileSwitchBody.includes('reset_speed_test_state("profile switched; previous speed test cancelled", true)') &&
    speedBody.includes('speed.run_id != run_id') &&
    appJs.includes('function resetSpeedUiForProfileSwitch') &&
    appJs.includes('resetSpeedUiForProfileSwitch();') &&
    appJs.includes('status.runId !== activeSpeedRunId'),
  'old subscription speed results must not write into the new subscription'
);

check(
  'standby core preparation does not enable traffic takeover when disconnected',
  ensureBody.includes('start_standby()?') &&
    ensureBody.includes('Speed test starting mihomo in standby without traffic takeover') &&
    mainRs.includes('settings.tun_enabled = false') &&
    mainRs.includes('apply_takeover_after_core_ready(enable_takeover)') &&
    mainRs.includes('trafficTakeover'),
  'speed preparation may start standby controller but not system proxy/TUN takeover'
);

check(
  'disconnect protection speed-test allow rules open and clean up inside worker',
  speedBody.includes('build_speed_test_firewall_script(') &&
    speedBody.includes('true,') &&
    speedBody.includes('cleanup_speed_firewall') &&
    speedBody.includes('false,') &&
    mainRs.includes('Speed test firewall window opened for ports') &&
    mainRs.includes('remoteport=$portList'),
  'temporary firewall window is scoped to active speed test'
);

check(
  'speed-test UI remains non-blocking',
  appJs.includes('speedTestStarting') &&
    appJs.includes('speedTestButtons') &&
    appJs.includes('function applySpeedStatusToNodes') &&
    appJs.includes("scheduleRowsRender(latestGroup.items, { force: true, target: 'all', delay: 0 })") &&
    appJs.includes('function refreshVisibleNodesForSpeed') &&
    appJs.includes('queueNodeRefresh') &&
    !appJs.includes("$('#quickTestBtn').onclick = (event) => runButtonAction"),
  'foreground UI is not marked busy and speed results update home/nodes together'
);

check(
  'low-latency threshold is strictly below 100 ms',
  appJs.includes('Number(delay) < 100') &&
    appJs.includes('delay-good') &&
    appJs.includes('delay-bad') &&
    mainRs.includes('low_latency_names') &&
    mainRs.includes('health.last_delay < 100') &&
    mainRs.includes('item.last_delay >= 100'),
  'low-latency list and colors use <100 ms'
);

check(
  'failed speed tests keep a visible structured reason',
  mainRs.includes('last_failure_reason') &&
    mainRs.includes('lastFailureReason') &&
    mainRs.includes('DelayTestResult') &&
    mainRs.includes('classify_failure_reason(&err.to_string())') &&
    appJs.includes('function speedFailureReasonLabel') &&
    appJs.includes('function nodeSpeedNoteInfo') &&
    appJs.includes('speedFailureReasonLabel(failureReason)') &&
    appJs.includes('className: \'node-note note-bad\'') &&
    indexHtml.includes('<span>状态</span>'),
  'tested failed nodes must show timeout/DNS/TLS/auth/etc. in a dedicated status column instead of reverting to untested'
);

check(
  'speed-test targets exclude airport metadata and fake-ip nodes',
  mainRs.includes('fn is_subscription_metadata_node_name') &&
    mainRs.includes('fn sanitize_subscription_metadata_nodes') &&
    mainRs.includes('is_subscription_metadata_node_name(name)') &&
    mainRs.includes('fn is_fake_ip_address') &&
    mainRs.includes('subscription_metadata_nodes_are_removed_before_runtime_and_speed'),
  'Traffic/Expire rows and 198.18/198.19 fake-ip targets must never enter speed testing'
);

check(
  'runtime DNS avoids FlClash local fake-ip resolver contamination',
  mainRs.includes('fn harden_runtime_dns') &&
    mainRs.includes('const AEGOS_DNS_LISTEN: &str = "127.0.0.1:1054"') &&
    mainRs.includes('proxy-server-nameserver') &&
    mainRs.includes('https://223.5.5.5/dns-query') &&
    mainRs.includes('https://1.1.1.1/dns-query') &&
    mainRs.includes('runtime_dns_is_isolated_from_local_fake_ip_resolvers'),
  'proxy server domain lookup must use direct upstream resolvers, not 127.0.0.1:1053 or fake-ip DNS'
);

check(
  'advanced protocols have explicit adaptive scheduling',
  mainRs.includes('protocol_family("hysteria2")') &&
    mainRs.includes('protocol_concurrency("tuic")') &&
    mainRs.includes('protocol_concurrency("hysteria2")') &&
    mainRs.includes('protocol_scheduler_handles_reality_hysteria2_and_tuic_explicitly') &&
    mainRs.includes('"tuic" => 8') &&
    mainRs.includes('"hysteria" | "wireguard" => 10') &&
    mainRs.includes('FLCLASH_STYLE_SPEED_BATCH_SIZE: usize = 100') &&
    mainRs.includes('text.contains("reality")'),
  'TUIC/Reality/Hysteria2 have tested scheduler branches'
);

check(
  'batch speed probes align with FlClash delay-test defaults',
  mainRs.includes('fn delay_probe_plan') &&
    mainRs.includes('enum DelayProbeDepth') &&
    mainRs.includes('DelayProbeDepth::Fast') &&
    mainRs.includes('DelayProbeDepth::Full') &&
    mainRs.includes('fn protocol_fast_timeout_ms') &&
    mainRs.includes('const FLCLASH_STYLE_TEST_URL') &&
    mainRs.includes('https://www.gstatic.com/generate_204') &&
    mainRs.includes('assert_eq!(fast_tuic_probes.len(), 1)') &&
    mainRs.includes('assert_eq!(fast_tuic_probes[0].timeout_ms, 5000)') &&
    mainRs.includes('"https://www.gstatic.com/generate_204"') &&
    mainRs.includes('assert!(tuic_probes.iter().all(|probe| probe.timeout_ms == 5000))') &&
    mainRs.includes('"https://cp.cloudflare.com/generate_204"') &&
    mainRs.includes('set_yaml(&mut config, "unified-delay", YamlValue::Bool(true))') &&
    mainRs.includes('set_yaml(&mut config, "tcp-concurrent", YamlValue::Bool(true))'),
  'batch uses FlClash-style single URL; full probe is kept for single-node diagnostics'
);

check(
  'interaction smoke covers no-switch and navigation responsiveness',
  interactionSmoke.includes('speed test triggered a proxy switch') &&
    interactionSmoke.includes('batch speed test triggered a proxy switch') &&
    interactionSmoke.includes('speed test blocked sidebar page switching') &&
    interactionSmoke.includes('node page did not receive quick home speed results') &&
    interactionSmoke.includes('home page did not receive node batch speed results') &&
    interactionSmoke.includes('home filter switch left rows stuck in testing state after speed test'),
  'runtime UI regressions are covered by interaction smoke'
);

check(
  'release/backend audits include speed closure guards',
  backendAudit.includes('speed tests use standby core without traffic takeover or proxy switching') &&
    backendAudit.includes('disconnect protection allows speed tests without disabling protection') &&
    releaseAudit.includes('speed test uses standby core without traffic takeover or proxy switching') &&
    releaseAudit.includes('speed tests do not mark the whole foreground busy'),
  'broader audits still guard speed strategy'
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
