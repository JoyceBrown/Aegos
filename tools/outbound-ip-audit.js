import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
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
    refreshUiBody.includes("outboundIpLastStable = '-'") &&
    refreshUiBody.includes("setOutboundIpText('\\u67e5\\u8be2\\u5931\\u8d25'") &&
    refreshUiBody.includes('lastBackgroundJobError'),
  'failed current lookup shows a visible failure state instead of a stale IP'
);

check(
  'node changes and connect trigger background landing IP refresh',
  appJs.includes("runBackgroundJob('refreshOutboundIp'") &&
    appJs.includes("if (kind === 'startCore') void refreshOutboundIpAfterNodeChange()") &&
    appJs.includes('if (result) void refreshOutboundIpAfterNodeChange()') &&
    interactionSmoke.includes('node switch did not auto refresh outbound IP') &&
    interactionSmoke.includes('first connect did not auto refresh outbound IP'),
  'connect and node switch refresh IP without blocking'
);

check(
  'smart/rule mode IP lookup routes through hidden current-node group',
  mainRs.includes('const AEGOS_OUTBOUND_IP_GROUP') &&
    mainRs.includes('const OUTBOUND_IP_RULE_DOMAINS') &&
    mainRs.includes('fn upsert_outbound_ip_group') &&
    mainRs.includes('fn sync_outbound_ip_group_selection') &&
    mainRs.includes('fn insert_outbound_ip_rules') &&
    mainRs.includes('DOMAIN,{domain},{target}') &&
    ruleTestBody.includes('Aegos Landing IP') &&
    ruleTestBody.includes('Some("Node A")'),
  'internal IP-check domains use current selected node'
);

check(
  'backend IP lookup uses multiple providers with validation',
  mainRs.includes('normalize_outbound_ip_response') &&
    queryBody.includes('https://api.ipify.org') &&
    queryBody.includes('https://checkip.amazonaws.com') &&
    queryBody.includes('https://icanhazip.com') &&
    queryBody.includes('http://api.ipify.org') &&
    mainRs.includes('candidate.parse::<IpAddr>().is_ok()') &&
    queryBody.includes('timeout(Duration::from_millis(2800))'),
  'validated multi-provider lookup prevents long stuck states'
);

check(
  'detached backend job keeps cached value on temporary provider failure',
  detachedBody.includes('query_outbound_ip(mixed_port)') &&
    detachedBody.includes('sync_outbound_ip_group_selection') &&
    detachedBody.includes('outbound_ip_cache') &&
    detachedBody.includes('keeping cached value') &&
    mainRs.includes('Ok(fallback)') &&
    mainRs.includes('Err(reason)'),
  'temporary failures keep useful visible value when available'
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
