import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n'); }
function exists(rel) { return fs.existsSync(path.join(root, rel)); }
function check(name, ok, detail = '') { (ok ? pass : fail).push({ name, ok: Boolean(ok), detail }); }

const pkg = JSON.parse(read('package.json'));
const mainRs = read('src-tauri/src/main.rs');
const deploymentRs = read('src-tauri/src/config_deployment.rs');
const releaseAudit = read('tools/release-audit.js');
const release = exists('RELEASE_3.6.8.md') ? read('RELEASE_3.6.8.md') : '';
const semverAtLeast = (version, baseline) => {
  const current = String(version).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const minimum = String(baseline).split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(current.length, minimum.length); index += 1) {
    const left = current[index] || 0;
    const right = minimum[index] || 0;
    if (left !== right) return left > right;
  }
  return true;
};

check('current version carries stage 4 forward', semverAtLeast(pkg.version, '3.6.8'), pkg.version);
check('stage 4 audit is exposed by package scripts', pkg.scripts?.['audit:config-deployment'] === 'node tools/config-deployment-audit.js', 'npm run audit:config-deployment');
check('candidate deployment owns stage, promotion, completion, rollback, and startup recovery', ['pub struct ConfigDeploymentTransaction', 'pub fn stage(', 'pub fn promote(', 'pub fn complete(', 'pub fn rollback(', 'pub fn recover_interrupted_deployments('].every((token) => deploymentRs.includes(token)), 'src-tauri/src/config_deployment.rs');
check('deployment stores only managed candidate, backup, and journal artifacts', deploymentRs.includes('config-deployments') && deploymentRs.includes('.candidate') && deploymentRs.includes('.backup') && deploymentRs.includes('ConfigDeploymentReport') && deploymentRs.includes('ensure_within(') && deploymentRs.includes('atomic_write('), 'managed transaction storage');
check('stage 4 has explicit failure recovery paths', deploymentRs.includes('candidate digest verification failed') && deploymentRs.includes('active digest verification failed') && deploymentRs.includes('recovered-after-interruption') && deploymentRs.includes('rollback snapshot is unavailable'), 'candidate/active/crash/rollback failure branches');
check('routing writers use staged transactions for both profile files and the independent rule store', mainRs.includes('fn deploy_profile_config(') && mainRs.includes('"Routing undo"') && mainRs.includes('"Routing group edit"') && mainRs.includes('self.commit_profile_routing_config(') && mainRs.includes('fn stage_routing_store_transaction(') && mainRs.includes('fn finish_routing_store_transaction(') && mainRs.includes('fn rollback_routing_store_transaction(') && mainRs.includes('fn recover_interrupted_routing_store_transaction(') && mainRs.includes('fn apply_user_rule_store_drafts(') && mainRs.includes('fn apply_user_rule_store_edit('), 'routing configuration and rule-store writers');
check('subscription import and update use the deployment transaction', mainRs.includes('"Subscription import"') && mainRs.includes('"Subscription update"') && mainRs.includes('Subscription candidate promoted and profile registration/runtime apply verified.') && mainRs.includes('Subscription candidate promoted and profile metadata/runtime apply verified.') && mainRs.includes('"subscription runtime hot reload failed"') && mainRs.includes('deployment.rollback_with_runtime(') && mainRs.includes('deployment.complete_verified(') && mainRs.includes('core.hot_reload_runtime_plan(&profile, &plan)') && mainRs.includes('combine_restore_results('), 'subscription configuration writers');
check('fixed-node settings use the same candidate transaction', mainRs.includes('fn stage_settings_deployment(') && mainRs.includes('"Fixed node save"') && mainRs.includes('deployment.rollback_with_runtime(') && mainRs.includes('deployment.complete_verified('), 'manual-node configuration writer');
check('promoted config must pass runtime/controller identity before completion', mainRs.includes('let controller_ready = !was_running || reload.is_ok();') && mainRs.includes('let runtime_identity_ok = !was_running') && mainRs.includes('"versionProbeCount".to_string(), json!(1)') && !mainRs.includes('let controller_ready = !was_running || self.core_controller().runtime_reuse_ready();') && mainRs.includes('Candidate promoted, Mihomo reloaded, controller and runtime identity verified.') && mainRs.includes('recover_interrupted_deployments(&app_data, &profile_dir)'), 'single-probe post-deploy verification and startup recovery');
check('verified completion and rollback always reconcile runtime state', deploymentRs.includes('pub fn rollback_with_runtime') && deploymentRs.includes('let runtime_restore = restore_runtime();') && deploymentRs.includes('pub fn complete_verified') && mainRs.includes('deployment.complete_verified(') && mainRs.includes('deployment.rollback_with_runtime('), 'completion journal failure and rollback errors cannot silently skip runtime restoration');
check('deployment transaction has fault-injection unit coverage', deploymentRs.includes('promotes_verified_candidate_and_keeps_a_rollback_snapshot') && deploymentRs.includes('rolls_back_an_existing_config_after_runtime_failure') && deploymentRs.includes('startup_recovers_promoted_but_unverified_config') && deploymentRs.includes('completion_journal_failure_rolls_back_config_and_runtime') && deploymentRs.includes('runtime_restore_is_attempted_when_active_config_rollback_fails') && deploymentRs.includes('runtime_restore_is_attempted_when_rollback_journal_write_fails'), 'src-tauri/src/config_deployment.rs tests');
check('release audit knows the stage 4 deployment gate', releaseAudit.includes('config deployment audit script exists') && releaseAudit.includes('tools/config-deployment-audit.js') && releaseAudit.includes('audit:config-deployment'), 'tools/release-audit.js');
check('stage 4 release records deployment fault coverage', release.includes('3.6.1') && release.includes('3.6.8') && release.includes('npm run audit:config-deployment') && release.includes('cargo test --manifest-path src-tauri/Cargo.toml config_deployment') && release.includes('npm run audit:stage2-closure') && release.includes('npm run audit:stage3-acceptance'), 'RELEASE_3.6.8.md');
check(
  'current source tree keeps the stage 4 gate',
  pkg.scripts?.['audit:config-deployment'] === 'node tools/config-deployment-audit.js' &&
    releaseAudit.includes('config deployment audit script exists') &&
    releaseAudit.includes('audit:config-deployment'),
  'package.json / tools/release-audit.js'
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
