import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const passed = [];
const failed = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

function check(name, ok, detail = '') {
  (ok ? passed : failed).push({ name, detail });
}

const mainRs = read('src-tauri/src/main.rs');
const coreDomainRs = read('src-tauri/src/core_domain.rs');
const coreRuntimeRs = read('src-tauri/src/core_runtime.rs');
const appJs = read('src/app.js');
const backendAudit = read('tools/backend-audit.js');
const runtimeAudit = read('tools/core-runtime-audit.js');
const releaseAudit = read('tools/release-audit.js');

check(
  'connection controller payload has one Aegos normalization boundary',
  mainRs.includes('mod core_domain;') &&
    coreDomainRs.includes('pub struct ConnectionSnapshot') &&
    coreDomainRs.includes('pub fn connection_snapshots_from_controller') &&
    coreDomainRs.includes('.get("connections")') &&
    coreDomainRs.includes('.get("metadata")') &&
    coreDomainRs.includes('.get("chains")'),
  'raw controller fields belong only in core_domain.rs',
);

check(
  'Aegos connection snapshots expose stable product fields',
  ['id', 'target', 'rule', 'route', 'upload', 'download', 'process', 'network', 'protocol']
    .every((field) => coreDomainRs.includes(`pub ${field}:`)) &&
    coreDomainRs.includes('#[serde(rename_all = "camelCase")]'),
  'ConnectionSnapshot contract is incomplete',
);

check(
  'traffic stream is normalized into an Aegos snapshot',
  coreDomainRs.includes('pub struct TrafficSnapshot') &&
    coreDomainRs.includes('pub fn traffic_snapshot_from_controller_line') &&
    coreDomainRs.includes('if !payload.is_object()') &&
    coreRuntimeRs.includes('Result<TrafficSnapshot, String>') &&
    coreRuntimeRs.includes('traffic_snapshot_from_controller_line(&line)') &&
    coreRuntimeRs.includes('last_traffic: &TrafficSnapshot') &&
    mainRs.includes('last_traffic: TrafficSnapshot'),
  'raw /traffic JSON must not flow through runtime or product state',
);

check(
  'proxy groups are normalized before entering product logic',
  coreDomainRs.includes('pub struct ProxyNodeSnapshot') &&
    coreDomainRs.includes('pub struct ProxyGroupSnapshot') &&
    coreDomainRs.includes('pub fn proxy_groups_from_controller') &&
    coreDomainRs.includes('fn effective_delay(&self)') &&
    coreRuntimeRs.includes('fn proxies_payload(&self, timeout_ms: u64)') &&
    !coreRuntimeRs.includes('pub fn proxies_payload') &&
    coreRuntimeRs.includes('Result<Vec<ProxyGroupSnapshot>, String>') &&
    coreRuntimeRs.includes('proxy_groups_from_controller(&data, hidden_group_names)') &&
    !coreRuntimeRs.includes('fn normalize_proxy_item'),
  'raw /proxies records must not pass through the runtime or frontend',
);

check(
  'proxy catalog transformations are owned by one Aegos domain model',
  coreDomainRs.includes('pub struct ProxyCatalog') &&
    coreDomainRs.includes('pub fn from_product_json') &&
    coreDomainRs.includes('pub fn ensure_default_groups') &&
    coreDomainRs.includes('pub fn apply_selected_map') &&
    coreDomainRs.includes('pub fn annotate_manual_nodes') &&
    coreDomainRs.includes('pub fn nodes_mut') &&
    coreDomainRs.includes('fn collect_real_nodes') &&
    coreRuntimeRs.includes('pub fn shape_proxy_catalog_model(') &&
    mainRs.includes('core_runtime::shape_proxy_catalog_model(') &&
    mainRs.includes('fn apply_speed_test_delays_from_state(catalog: &mut ProxyCatalog') &&
    mainRs.includes('for item in catalog.nodes_mut()') &&
    mainRs.includes('proxy_catalog_speed_enrichment_preserves_one_product_contract') &&
    !coreRuntimeRs.includes('pub fn normalize_proxy_groups_snapshot_defaults(') &&
    !coreRuntimeRs.includes('pub fn apply_group_resolution_with_selected_map(') &&
    !coreRuntimeRs.includes('pub fn annotate_manual_groups_with_names('),
  'defaults, selections, group references, and manual metadata must not drift across JSON mutation helpers',
);

check(
  'delay probe responses are normalized before classification',
  coreDomainRs.includes('pub struct DelayProbeSnapshot') &&
    coreDomainRs.includes('pub fn delay_probe_from_controller') &&
    coreRuntimeRs.includes('Result<DelayProbeSnapshot, CoreControllerHttpFailure>') &&
    coreRuntimeRs.includes('delay_probe_from_controller(&payload)') &&
    coreRuntimeRs.includes('fn normalize_delay_probe_response(data: &DelayProbeSnapshot)') &&
    coreDomainRs.includes('delay_probe_normalizes_success_and_failure_envelopes'),
  'delay/message/error controller fields must stay at the core-domain boundary',
);

check(
  'generic controller transport is private',
  coreRuntimeRs.includes('fn request(') &&
    !coreRuntimeRs.includes('pub fn request(') &&
    coreRuntimeRs.includes('fn controller_request(') &&
    !coreRuntimeRs.includes('pub fn controller_request'),
  'new controller endpoints must use named typed methods',
);

check(
  'runtime version and config apply receipts are Aegos-owned',
  coreDomainRs.includes('pub struct RuntimeVersionSnapshot') &&
    coreDomainRs.includes('pub fn runtime_version_from_controller') &&
    coreRuntimeRs.includes('fn version_probe(&self, timeout_ms: u64) -> Result<RuntimeVersionSnapshot, String>') &&
    !coreRuntimeRs.includes('pub fn version_probe') &&
    coreRuntimeRs.includes('fn apply_runtime_config_path(&self, path: &Path) -> Result<(), String>') &&
    coreRuntimeRs.includes('fn config_apply_version_probe(&self) -> Result<RuntimeVersionSnapshot, String>') &&
    coreRuntimeRs.includes('pub runtime_version: RuntimeVersionSnapshot') &&
    !coreRuntimeRs.includes('pub controller_response: JsonValue') &&
    !coreRuntimeRs.includes('pub version_probe: JsonValue') &&
    coreRuntimeRs.includes('pub fn receipt_json(&self) -> JsonValue') &&
    coreRuntimeRs.includes('runtime_apply_receipt_is_aegos_shaped') &&
    mainRs.includes('Ok(result.receipt_json())'),
  'hot reload must return an Aegos receipt instead of raw controller JSON',
);

check(
  'connection count and recent rule hits reuse typed snapshots',
  coreRuntimeRs.includes('Result<Vec<ConnectionSnapshot>, String>') &&
    coreRuntimeRs.includes('connection_snapshots_from_controller(&data, sanitize_runtime_display_text)') &&
    coreRuntimeRs.includes('let connections = self.connections_snapshot(timeout_ms)?;') &&
    coreRuntimeRs.includes('recent_rule_hits(&connections, limit)') &&
    coreRuntimeRs.includes('self.connections_snapshot(timeout_ms)\n            .map(|items| items.len())') &&
    !coreRuntimeRs.includes('recent_rule_hits_from_connections'),
  'derived connection features must not parse the controller payload again',
);

check(
  'frontend consumes Aegos fields instead of Mihomo connection JSON',
  appJs.includes('const target = item.target ||') &&
    appJs.includes('Array.isArray(item.route)') &&
    !/item\s*\.\s*metadata\b/.test(appJs) &&
    !/item\s*\.\s*chains\b/.test(appJs) &&
    !appJs.includes('destinationIP'),
  'frontend must not know metadata, destinationIP, or chains',
);

check(
  'connection normalization covers malformed and partial payloads',
  coreDomainRs.includes('controller_metadata_is_normalized_into_aegos_fields') &&
    coreDomainRs.includes('destination_and_safe_defaults_cover_partial_controller_rows') &&
  coreDomainRs.includes('malformed_envelope_is_rejected_at_the_core_boundary') &&
    coreDomainRs.includes('recent_hits_do_not_reprocess_normalized_sensitive_text') &&
    coreDomainRs.includes('traffic_payload_is_normalized_into_aegos_snapshot') &&
    coreDomainRs.includes('partial_traffic_payload_uses_safe_defaults') &&
    coreDomainRs.includes('empty_or_invalid_traffic_payload_is_rejected_at_boundary') &&
    coreDomainRs.includes('proxy_groups_keep_stable_map_order_and_normalize_latest_delay') &&
    coreDomainRs.includes('proxy_groups_hide_internal_and_empty_groups') &&
    coreDomainRs.includes('malformed_proxy_envelope_is_rejected_at_boundary') &&
    coreDomainRs.includes('product_proxy_catalog_owns_defaults_selection_and_manual_metadata') &&
    coreDomainRs.includes('product_proxy_catalog_bounds_cyclic_group_resolution') &&
    coreDomainRs.includes('product_proxy_catalog_rejects_non_array_envelopes'),
  'normalization tests are incomplete',
);

check(
  'connection-domain boundary is enforced by architecture and release gates',
  backendAudit.includes('coreDomainRs') &&
    runtimeAudit.includes('coreDomainRs') &&
    releaseAudit.includes('coreDomainRs') &&
    releaseAudit.includes('core-domain-audit.js'),
  'top-level gates do not enforce the connection domain',
);

console.log(JSON.stringify({
  ok: failed.length === 0,
  failed,
  passed,
  generatedAt: new Date().toISOString(),
}, null, 2));

process.exit(failed.length ? 2 : 0);
