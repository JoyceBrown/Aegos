import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
const mainRs = read('src-tauri', 'src', 'main.rs');
const configDomainRs = read('src-tauri', 'src', 'config_domain.rs');
const configPipelineRs = read('src-tauri', 'src', 'config_pipeline.rs');
const profileCompilerRs = read('src-tauri', 'src', 'profile_compiler.rs');
const configDeploymentRs = read('src-tauri', 'src', 'config_deployment.rs');
const contract = read('core-api-contract.md');

const passed = [];
const failed = [];
function check(name, ok, detail = '') {
  (ok ? passed : failed).push({ name, ok, detail });
}

function section(source, start, end) {
  const begin = source.indexOf(start);
  const finish = source.indexOf(end, begin + start.length);
  return begin >= 0 && finish > begin ? source.slice(begin, finish) : '';
}

const allRust = [mainRs, configDomainRs, configPipelineRs, profileCompilerRs].join('\n');
const proxyModel = section(configDomainRs, 'pub struct CatalogProxy', 'pub struct CatalogGroup');
const patchProfileFile = section(mainRs, 'fn patch_profile_file(', 'fn runtime_profile_path(');
const routingDeploy = section(mainRs, 'fn deploy_profile_config(', 'fn commit_profile_routing_config(');
const routingRuleApply = section(mainRs, 'fn apply_user_rule_store_drafts(', 'fn apply_user_rule_store_edit(');
const diagnostics = section(mainRs, 'fn diagnostics_from_snapshot(', 'fn diagnostics_detached(');
const subscriptionImport = section(mainRs, 'fn add_profile_url_detached(', 'fn update_profile_detached(');
const subscriptionUpdate = section(mainRs, 'fn update_profile_detached(', 'fn refresh_outbound_ip_detached(');
const sourceCandidateUses = (mainRs.match(/plan\.source_deployment_candidate/g) || []).length;
const diagnosticsCompiles = (diagnostics.match(/profile_compiler::compile_profile_file/g) || []).length;
const updateDownloadIndex = subscriptionUpdate.indexOf('subscription_runtime::download_source_url(&url, AEGOS_SUBSCRIPTION_USER_AGENT)?;');
const updateOperationIndex = subscriptionUpdate.indexOf('lock_operation_queue(&operations, "updateProfile apply")?');
const updateRefreshIndex = subscriptionUpdate.indexOf('profile = core', updateOperationIndex);
const updateIdentityIndex = subscriptionUpdate.indexOf('profile.source_url.as_deref() != Some(url.as_str())');
const updateSnapshotIndex = subscriptionUpdate.indexOf('let previous_profile = profile.clone();');
const updateCompileIndex = subscriptionUpdate.indexOf('profile_compiler::compile_profile_source');
const updateStageIndex = subscriptionUpdate.indexOf('ConfigDeploymentTransaction::stage');

check(
  'configuration has an Aegos-owned domain boundary',
  mainRs.includes('mod config_domain;') &&
    configDomainRs.includes('pub struct ProfileCatalog') &&
    configDomainRs.includes('pub struct RuntimeConfigReport') &&
    configDomainRs.includes('pub struct ManualNodeConfig'),
  'config_domain module and typed models'
);

check(
  'catalog summaries cannot expose proxy credentials or endpoints',
  proxyModel.includes('pub name: String') &&
    proxyModel.includes('pub protocol: String') &&
    !proxyModel.includes('server') &&
    !proxyModel.includes('password') &&
    !proxyModel.includes('uuid') &&
    configDomainRs.includes('profile_catalog_extracts_only_product_metadata'),
  'CatalogProxy safe metadata and regression test'
);

check(
  'manual nodes are typed and product metadata is excluded from runtime YAML',
  mainRs.includes('manual_nodes: HashMap<String, HashMap<String, ManualNodeConfig>>') &&
    mainRs.includes('fn normalize_manual_node(input: &JsonValue) -> Result<ManualNodeConfig, String>') &&
    configPipelineRs.includes('node: &ManualNodeConfig') &&
    configPipelineRs.includes('let proxy = node.runtime_yaml()?') &&
    !mainRs.includes('fn manual_node_yaml(') &&
    configDomainRs.includes('pub fn runtime_yaml(&self)') &&
    configDomainRs.includes('pub fn product_json(&self)') &&
    configDomainRs.includes('manual_node_model_separates_runtime_fields_from_product_metadata') &&
    configDomainRs.includes('old_manual_node_metadata_is_filtered_when_settings_are_loaded'),
  'typed settings storage and legacy filtering'
);

check(
  'one compiler builds source and runtime artifacts with independent digests',
  profileCompilerRs.includes('pub(crate) struct RuntimeDeploymentPlan') &&
    profileCompilerRs.includes('source_catalog: ProfileCatalog') &&
    profileCompilerRs.includes('runtime_catalog: ProfileCatalog') &&
    profileCompilerRs.includes('pub(crate) source_yaml: String') &&
    profileCompilerRs.includes('pub(crate) runtime_yaml: String') &&
    profileCompilerRs.includes('source_digest: sha256_text(&source_yaml)') &&
    profileCompilerRs.includes('runtime_digest: sha256_text(&runtime_yaml)') &&
    profileCompilerRs.includes('config_pipeline::compile_runtime_catalog(') &&
    configPipelineRs.includes('core_runtime::preflight_runtime_config(') &&
    configPipelineRs.includes('subscription_runtime::AEGOS_URI_PROTOCOLS') &&
    !configPipelineRs.includes('preflight_runtime_config,') &&
    profileCompilerRs.includes('deployment_plan_separates_subscription_source_from_runtime_policy'),
  'RuntimeDeploymentPlan source/runtime separation'
);

check(
  'legacy public patch and preflight entry points cannot return',
  !allRust.includes('pub(crate) fn patch_profile_source') &&
    !allRust.includes('pub(crate) fn patch_and_preflight') &&
    !allRust.includes('pub(crate) fn preflight_profile_source') &&
    !allRust.includes('struct RenderedProfile') &&
    !mainRs.includes('fn patch_config_with_settings(') &&
    configPipelineRs.includes('pub(crate) fn patch_config(') &&
    configPipelineRs.includes('fn sanitize_subscription_metadata_nodes(') &&
    configPipelineRs.includes('fn apply_manual_nodes(') &&
    configPipelineRs.includes('fn insert_outbound_ip_rules(') &&
    configPipelineRs.includes('pub(crate) fn compile_runtime_catalog'),
  'single compile_runtime_catalog entry point'
);

check(
  'subscription import and update persist source artifacts only',
  sourceCandidateUses >= 3 &&
    mainRs.includes('profile_compiler::compile_profile_source(source.config, &profile, &settings)') &&
    profileCompilerRs.includes('pub(crate) fn source_deployment_candidate(') &&
    profileCompilerRs.includes('self.source_yaml.clone()') &&
    profileCompilerRs.includes('candidate.digest() != self.source_digest') &&
    profileCompilerRs.includes('source_candidate_is_bound_to_the_compiled_source_digest_and_managed_path') &&
    !mainRs.includes('plan.runtime_yaml'),
  `source candidate uses: ${sourceCandidateUses}`
);

check(
  'runtime rendering never writes generated policy back to the subscription source',
  patchProfileFile.includes('self.render_runtime_profile(profile)?') &&
    patchProfileFile.includes('self.write_runtime_deployment_plan(') &&
    !patchProfileFile.includes('atomic_write_text_confined') &&
    !patchProfileFile.includes('source_yaml'),
  'patch_profile_file writes only the Aegos runtime artifact'
);

check(
  'routing deploy compiles once and hot reloads the same verified plan',
  (routingRuleApply.match(/self\.render_runtime_profile\(&profile\)/g) || []).length === 1 &&
    (routingRuleApply.match(/self\.hot_reload_runtime_plan\(&profile, &plan\)/g) || []).length === 1 &&
    routingRuleApply.includes('stage_routing_store_transaction(') &&
    routingRuleApply.includes('"runtimePreflight": plan.validation_json()') &&
    routingRuleApply.includes('finish_routing_store_transaction(') &&
    routingRuleApply.indexOf('let plan = self.render_runtime_profile(&profile)?') <
      routingRuleApply.indexOf('self.hot_reload_runtime_plan(&profile, &plan)?'),
  'stage rule store, compile one runtime plan, hot reload the same plan, verify transaction'
);

check(
  'deployment candidate binds path, operation, profile, content, and digest',
  configDeploymentRs.includes('pub struct ConfigDeploymentCandidate') &&
    configDeploymentRs.includes('active_root: PathBuf') &&
    configDeploymentRs.includes('active_path: PathBuf') &&
    configDeploymentRs.includes('operation: String') &&
    configDeploymentRs.includes('profile_id: String') &&
    configDeploymentRs.includes('content: String') &&
    configDeploymentRs.includes('digest: String') &&
    configDeploymentRs.includes('pub fn stage(state_root: &Path, candidate: ConfigDeploymentCandidate)'),
  'typed deployment input'
);

check(
  'diagnostics compiles one immutable runtime plan per snapshot',
  diagnostics.includes('let runtime_plan = snapshot') &&
    diagnosticsCompiles === 1 &&
    diagnostics.includes('runtime_plan.as_ref().map(|runtime|') &&
    diagnostics.includes('runtime_dns_safety_report(plan.runtime_catalog().config())'),
  `compile calls in diagnostics: ${diagnosticsCompiles}`
);

check(
  'subscription runtime apply reuses one plan without restarting the core on success',
  (subscriptionImport.match(/profile_compiler::compile_profile_source/g) || []).length === 1 &&
    (subscriptionUpdate.match(/profile_compiler::compile_profile_source/g) || []).length === 1 &&
    subscriptionImport.includes('core.hot_reload_runtime_plan(&profile, &plan)') &&
    subscriptionUpdate.includes('core.hot_reload_runtime_plan(&profile, &plan)') &&
    !subscriptionImport.includes('restart_core_preserving_proxy(250)') &&
    !subscriptionUpdate.includes('restart_core_preserving_proxy(250)') &&
    subscriptionImport.includes('runtime hot reload completed in {} ms without core restart') &&
    subscriptionUpdate.includes('runtime hot reload completed in {} ms without core restart'),
  'one compile, one hot apply, measured elapsed time'
);

check(
  'subscription update discards stale downloads before configuration mutation',
  updateDownloadIndex >= 0 &&
    updateDownloadIndex < updateOperationIndex &&
    updateOperationIndex < updateRefreshIndex &&
    updateRefreshIndex < updateIdentityIndex &&
    updateIdentityIndex < updateSnapshotIndex &&
    updateSnapshotIndex < updateCompileIndex &&
    updateCompileIndex < updateStageIndex &&
    subscriptionUpdate.includes('Subscription address changed while the update was downloading; the downloaded result was discarded.'),
  'download outside operation queue, then refresh identity/settings, snapshot, compile, and stage'
);

check(
  'subscription hot-reload failures restore file, settings, and previous runtime',
  subscriptionImport.includes('deployment.rollback_with_runtime(') &&
    subscriptionUpdate.includes('deployment.rollback_with_runtime(') &&
    subscriptionImport.includes('core.settings.active_profile_id = previous_profile_id.clone()') &&
    subscriptionUpdate.includes('*stored = previous_profile.clone()') &&
    subscriptionImport.includes('let save_result = core.save_settings()') &&
    subscriptionUpdate.includes('let save_result = core.save_settings()') &&
    /core\s*\.\s*hot_reload_profile\(previous\)/.test(subscriptionImport) &&
    /core\s*\.\s*hot_reload_profile\(&previous_profile\)/.test(subscriptionUpdate) &&
    subscriptionImport.includes('core.start_from_restart_plan(rollback_plan)') &&
    subscriptionUpdate.includes('core.start_from_restart_plan(rollback_plan)') &&
    subscriptionImport.includes('rollback to {previous_profile_id} also failed') &&
    subscriptionUpdate.includes('restoring previous subscription also failed'),
  'verified rollback with process restart only as the final fallback'
);

check(
  'configuration ownership contract documents the enforced chain',
  contract.includes('## 8. Configuration Ownership Contract') &&
    contract.includes('subscription source -> ProfileCatalog -> RuntimeDeploymentPlan') &&
    contract.includes('ConfigDeploymentCandidate -> atomic promotion') &&
    contract.includes('Generated runtime fields must never be written back'),
  'core-api-contract.md'
);

const result = { ok: failed.length === 0, failed, passed, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
