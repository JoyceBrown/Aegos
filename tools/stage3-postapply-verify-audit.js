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
const release = exists(`RELEASE_${pkg.version}.md`) ? read(`RELEASE_${pkg.version}.md`) : '';
const applyStart = mainRs.indexOf('fn apply_routing_drafts');
const applyEnd = mainRs.indexOf('fn undo_last_routing_apply', applyStart);
const applyBody = applyStart >= 0 && applyEnd > applyStart ? mainRs.slice(applyStart, applyEnd) : '';
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
  applyBody.includes('runtime_reuse_ready()') &&
    applyBody.includes('controller_verified') &&
    applyBody.includes('Routing verification failed after hot reload') &&
    applyBody.includes('config was rolled back') &&
    applyBody.includes('atomic_write_text_confined(&profile_path, &self.profile_dir, &previous_raw)'),
  'controller verification with rollback'
);

check(
  'backend returns structured deployment validation report',
  applyBody.includes('"deploymentValidation"') &&
    applyBody.includes('"runtimePreflightOk"') &&
    applyBody.includes('"hotReloadRan"') &&
    applyBody.includes('"controllerReady"') &&
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
  release.includes('3.5.94') &&
    release.includes('规则应用后验证') &&
    release.includes('目标不存在') &&
    release.includes('部署验证') &&
    release.includes('npm run audit:stage3-postapply-verify') &&
    release.includes('Source-only'),
  `RELEASE_${pkg.version}.md`
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
