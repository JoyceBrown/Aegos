import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
const egressIdentityRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'egress_identity.rs'), 'utf8');
const nodeSelectionRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'node_selection.rs'), 'utf8');
const coreDomainRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'core_domain.rs'), 'utf8');
const configPipelineRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'config_pipeline.rs'), 'utf8');
const ipv6PolicyRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'ipv6_policy.rs'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const backendAudit = fs.readFileSync(path.join(root, 'tools', 'backend-audit.js'), 'utf8');
const releaseAudit = fs.readFileSync(path.join(root, 'tools', 'release-audit.js'), 'utf8');
const interactionSmoke = fs.readFileSync(path.join(root, 'tools', 'interaction-smoke.js'), 'utf8');

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

const refreshUiBody = appJs.match(/async function refreshOutboundIpAfterNodeChange\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] || '';
const detachedBody = sliceBetween(mainRs, 'fn refresh_outbound_ip_detached', 'fn job_label');
const queryBody = sliceBetween(mainRs, 'fn query_outbound_ip', '#[cfg(test)]');
const ruleTestBody = sliceBetween(mainRs, 'fn outbound_ip_lookup_rules_use_internal_current_node_group', 'fn running_switch_preflight_accepts_two_local_profiles');
const detachedIdentityIndex = detachedBody.indexOf('if !outbound_ip_query_is_current(');
const detachedStaleReturnIndex = detachedBody.indexOf('Outbound IP query expired after node changed; retrying will use the current node.');
const detachedFallbackIndex = detachedBody.indexOf('let fallback = core.outbound_observation.visible_ip()');

check(
  'UI sequences outbound IP requests and ignores stale results',
  appJs.includes('let outboundIpRequestSeq = 0') &&
    appJs.includes('let outboundIpPendingSeq = 0') &&
    refreshUiBody.includes('const seq = ++outboundIpRequestSeq') &&
    refreshUiBody.includes('if (seq !== outboundIpRequestSeq) return') &&
    refreshUiBody.includes('if (seq !== outboundIpRequestSeq) return null'),
  'newer node changes win over older IP lookups'
);

check(
  'UI never leaves landing IP stuck or disguised as valid after failure',
  refreshUiBody.includes("setOutboundIpText('\\u67e5\\u8be2\\u4e2d')") &&
    refreshUiBody.includes('outboundIpPendingSeq = 0') &&
    refreshUiBody.includes("state: 'failed'") &&
    appJs.includes("const queryFailed = availability.state === 'failed'") &&
    appJs.includes('if (queryFailed && !historical)') &&
    appJs.includes("text: '\\u67e5\\u8be2\\u5931\\u8d25'") &&
    refreshUiBody.includes('lastBackgroundJobError'),
  'failed current lookup shows either an explicit failure or a visibly stale cached IP'
);

check(
  'node changes and connect trigger background landing IP refresh',
  appJs.includes("runBackgroundJob('refreshOutboundIp'") &&
    appJs.includes("if (kind === 'startCore' && value?.trafficTakeover) void refreshOutboundIpAfterNodeChange()") &&
    appJs.includes('if (result && latestStatus?.trafficTakeover) void refreshOutboundIpAfterNodeChange()') &&
    interactionSmoke.includes('node switch did not auto refresh outbound IP') &&
    interactionSmoke.includes('first connect did not auto refresh outbound IP'),
  'connect and node switch refresh IP without blocking'
);

check(
  'smart/rule mode IP lookup routes through hidden current-node group',
  mainRs.includes('const AEGOS_OUTBOUND_IP_GROUP') &&
    mainRs.includes('const OUTBOUND_IP_RULE_DOMAINS') &&
    configPipelineRs.includes('fn upsert_outbound_ip_group') &&
    mainRs.includes('fn runtime_current_proxy_route') &&
    mainRs.includes('fn sync_outbound_ip_route') &&
    mainRs.includes('OUTBOUND_IP_RULE_PRIMARY_GROUPS') &&
    mainRs.includes('OUTBOUND_IP_GLOBAL_PRIMARY_GROUPS') &&
    coreDomainRs.includes('pub fn resolve_runtime_leaf') &&
    coreDomainRs.includes('pub fn group_contains_leaf') &&
    configPipelineRs.includes('fn insert_outbound_ip_rules') &&
    configPipelineRs.includes('DOMAIN,{domain},{target}') &&
    ruleTestBody.includes('Aegos Landing IP') &&
    ruleTestBody.includes('Some("Node A")'),
  'internal IP-check domains use current selected node'
);

check(
  'backend IP lookup uses multiple providers with validation',
  mainRs.includes('normalize_outbound_ip_response') &&
    mainRs.includes('const OUTBOUND_IP_SERVICES: [&str; 6]') &&
    mainRs.includes('https://api.ipify.org') &&
    mainRs.includes('https://checkip.amazonaws.com') &&
    mainRs.includes('https://icanhazip.com') &&
    !mainRs.includes('"http://api.ipify.org"') &&
    queryBody.includes('mpsc::channel()') &&
    queryBody.includes('receiver.recv_timeout(remaining)') &&
    mainRs.includes('parse::<IpAddr>()') &&
    mainRs.includes('OUTBOUND_IP_QUERY_TIMEOUT: Duration = Duration::from_millis(2600)') &&
    mainRs.includes('OUTBOUND_IP_QUERY_BUDGET: Duration = Duration::from_millis(3200)') &&
    mainRs.includes('outbound_ip_query_uses_https_race_with_bounded_budget'),
  'validated HTTPS provider race prevents long stuck states'
);

check(
  'detached backend marks cached value stale on temporary provider failure',
  detachedBody.includes('query_outbound_ip(mixed_port)') &&
    detachedBody.includes('core.runtime_outbound_ip_primary_group(),') &&
    detachedBody.includes('sync_outbound_ip_route(&controller, &mode, primary_group.as_deref())') &&
    detachedBody.includes('runtime_current_proxy_route(&controller, &mode, primary_group.as_deref())') &&
    mainRs.includes('fn outbound_ip_query_is_current(') &&
    mainRs.includes('fn outbound_ip_query_identity_rejects_stale_contexts()') &&
    detachedIdentityIndex >= 0 &&
    detachedStaleReturnIndex > detachedIdentityIndex &&
    detachedFallbackIndex > detachedStaleReturnIndex &&
    !detachedBody.includes('current_outbound_ip_proxy_name') &&
    detachedBody.includes('outbound_observation.record(') &&
    detachedBody.includes('cached evidence is now stale') &&
    detachedBody.includes('core.outbound_observation.invalidate()') &&
    detachedBody.includes('retained as stale') &&
    !detachedBody.includes('Ok(fallback)') &&
    mainRs.includes('Err(reason)'),
  'temporary failures retain the visible value but cannot report it as freshly available'
);

check(
  'outbound observation is identity-bound and invalidated by route-changing actions',
  mainRs.includes('mod egress_identity;') &&
    mainRs.includes('outbound_observation: egress_identity::EgressObservation') &&
    egressIdentityRs.includes('profile_id: String') &&
    egressIdentityRs.includes('mode: String') &&
    egressIdentityRs.includes('runtime_node: String') &&
    egressIdentityRs.includes('pub(super) fn matches_context(') &&
    egressIdentityRs.includes('"fixedEgressVerified"') &&
    egressIdentityRs.includes('"identityState"') &&
    mainRs.includes('if previous_mode != mode {\n            self.invalidate_egress_observation();') &&
    mainRs.includes('if previous_profile_id != id {\n            self.invalidate_egress_observation();') &&
    nodeSelectionRs.includes('if preflight.previous_proxy != proxy {\n            self.invalidate_egress_observation();') &&
    mainRs.includes('fn terminate_core_process(&mut self, message: &str) {\n        self.invalidate_egress_observation();'),
  'profile, mode, runtime node and observation freshness form one product contract'
);

check(
  'public IP remains visible in status but is not written to runtime logs',
  detachedBody.includes('core.add_log("Outbound IP refreshed.", "info")') &&
    !detachedBody.includes('Outbound IP refreshed: {ip}') &&
    !detachedBody.includes('cached value {fallback}'),
  'the explicit status surface may show the IP while logs and exports stay redacted'
);

check(
  'fixed egress report combines identity, DNS, TUN and IPv6 evidence without optimistic success',
  egressIdentityRs.includes('pub(super) fn consistency_report(') &&
    egressIdentityRs.includes('let ipv4_matches =') &&
    egressIdentityRs.includes('let dns_route_consistent =') &&
    egressIdentityRs.includes('let ipv6_consistent =') &&
    egressIdentityRs.includes('"fixedEgressVerified": state == "consistent" && fixed_node') &&
    ipv6PolicyRs.includes('egress_identity::consistency_report(&identity, dns_policy.as_ref(), &snapshot)') &&
    ipv6PolicyRs.includes('map.insert("egressConsistency".to_string(), consistency)') &&
    appJs.includes('function renderEgressConsistency(') &&
    appJs.includes("report.state === 'consistent'") &&
    interactionSmoke.includes('egress identity/DNS/TUN/IPv6 consistency report did not render'),
  'missing, stale, mismatched or partial evidence cannot render as fixed egress verified'
);

check(
  'route changes expire slow consistency probes and stale UI evidence remains explicit',
  ipv6PolicyRs.includes('fn snapshot_context_is_current(') &&
    ipv6PolicyRs.includes('core.outbound_ip_query_generation') &&
    ipv6PolicyRs.includes('IPv6/DNS snapshot expired after the route identity changed.') &&
    ipv6PolicyRs.includes('fn route_identity_change_expires_slow_snapshot()') &&
    appJs.includes("availability.state === 'stale'") &&
    appJs.includes('if (result && latestStatus?.trafficTakeover) void refreshOutboundIpAfterNodeChange()') &&
    interactionSmoke.includes('stale outbound observation was displayed as current') &&
    interactionSmoke.includes('connected mode switch did not invalidate and refresh outbound identity'),
  'slow probes and cached values cannot overwrite a newer node/profile/mode identity'
);

check(
  'broader audits guard landing IP strategy',
  backendAudit.includes('smart-mode outbound IP lookup uses an internal current-node group') &&
    backendAudit.includes('subscription and outbound IP jobs reduce core lock scope') &&
    releaseAudit.includes('smart-mode outbound IP lookup routes through hidden current-node group') &&
    releaseAudit.includes('node switch auto refreshes outbound IP without blocking node switching'),
  'release/backend audits cover IP routing and UI refresh triggers'
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
