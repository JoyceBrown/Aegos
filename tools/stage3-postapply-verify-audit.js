import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok: Boolean(ok), detail });
}

const pkg = JSON.parse(read('package.json'));
const appJs = read('src/app.js');
const mainRs = read('src-tauri/src/main.rs');
const releaseAudit = read('tools/release-audit.js');
const checkpointRelease = exists('RELEASE_3.5.94.md') ? read('RELEASE_3.5.94.md') : '';
const applyStart = mainRs.indexOf('fn apply_user_rule_store_drafts');
const applyEnd = mainRs.indexOf('fn apply_user_rule_store_edit', applyStart);
const applyBody = applyStart >= 0 && applyEnd > applyStart ? mainRs.slice(applyStart, applyEnd) : '';
const deployStart = mainRs.indexOf('fn deploy_profile_config');
const deployEnd = mainRs.indexOf('fn commit_profile_routing_config', deployStart);
const deployBody = deployStart >= 0 && deployEnd > deployStart ? mainRs.slice(deployStart, deployEnd) : '';
const hotReloadStart = mainRs.indexOf('fn hot_reload_runtime_plan');
const hotReloadEnd = mainRs.indexOf('fn ensure_runtime_ports', hotReloadStart);
const hotReloadBody = hotReloadStart >= 0 && hotReloadEnd > hotReloadStart ? mainRs.slice(hotReloadStart, hotReloadEnd) : '';
const renderStart = appJs.indexOf('function renderRoutingApplyStatus');
const renderEnd = appJs.indexOf('async function applyRoutingDrafts', renderStart);
const renderBody = renderStart >= 0 && renderEnd > renderStart ? appJs.slice(renderStart, renderEnd) : '';
const frontendApplyStart = appJs.indexOf('async function applyRoutingDrafts');
const frontendApplyEnd = appJs.indexOf('async function undoLastRoutingApply', frontendApplyStart);
const frontendApplyBody = frontendApplyStart >= 0 && frontendApplyEnd > frontendApplyStart ? appJs.slice(frontendApplyStart, frontendApplyEnd) : '';

function versionAtLeast(version, minimum) {
  const parse = (value) => String(value).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const current = parse(version);
  const target = parse(minimum);
  for (let index = 0; index < Math.max(current.length, target.length); index += 1) {
    const left = current[index] || 0;
    const right = target[index] || 0;
    if (left !== right) return left > right;
  }
  return true;
}

check('version keeps the 3.5.94+ post-apply verification checkpoint active', versionAtLeast(pkg.version, '3.5.94'), pkg.version);
check('package exposes the stage 3 post-apply verification audit', pkg.scripts?.['audit:stage3-postapply-verify'] === 'node tools/stage3-postapply-verify-audit.js', 'npm run audit:stage3-postapply-verify');

check(
  'backend verifies controller readiness after hot reload and rolls back on verification failure',
  applyBody.includes('self.render_runtime_profile(&profile)?') &&
    applyBody.includes('self.hot_reload_runtime_plan(&profile, &plan)?') &&
    applyBody.includes('rollback_routing_store_transaction(') &&
    applyBody.includes('self.hot_reload_profile(&profile)') &&
    hotReloadBody.includes('"versionProbeCount".to_string(), json!(1)') &&
    hotReloadBody.includes('CoreRuntimeApplyTransaction::new') &&
    hotReloadBody.includes('apply(&self.core_controller())?') &&
    !hotReloadBody.includes('self.wait_for_controller()?'),
  'one-probe controller verification, Aegos identity check, and file/runtime rollback'
);

check(
  'backend returns structured deployment validation report',
  applyBody.includes('deployment.get("deploymentValidation")') &&
    applyBody.includes('"deploymentValidation"') &&
    applyBody.includes('"candidateValidated"') &&
    applyBody.includes('"hotReloadRan"') &&
    applyBody.includes('"controllerReady"') &&
    applyBody.includes('"runtimeIdentity"') &&
    applyBody.includes('"rollbackReady"') &&
    applyBody.includes('"verifiedAt"'),
  'deploymentValidation response'
);

check(
  'frontend surfaces deployment validation result',
  renderBody.includes('部署验证：') &&
    renderBody.includes('deploymentValidation?.controllerReady') &&
    frontendApplyBody.includes('deploymentValidation: result.deploymentValidation || null'),
  'routing apply status validation display'
);

check(
  'release audit knows the stage 3 post-apply verification gate',
  releaseAudit.includes('stage 3 post-apply verification audit script exists') &&
    releaseAudit.includes('tools/stage3-postapply-verify-audit.js') &&
    releaseAudit.includes('audit:stage3-postapply-verify'),
  'tools/release-audit.js'
);

check(
  'release note records plan and verification for 3.5.94',
  checkpointRelease.includes('3.5.94') &&
    checkpointRelease.includes('规则应用后验证') &&
    checkpointRelease.includes('目标不存在') &&
    checkpointRelease.includes('部署验证') &&
    checkpointRelease.includes('npm run audit:stage3-postapply-verify'),
  'RELEASE_3.5.94.md'
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
