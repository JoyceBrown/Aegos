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
const styles = read('src/styles.css');
const mainRs = read('src-tauri/src/main.rs');
const releaseAudit = read('tools/release-audit.js');
const release = exists(`RELEASE_${pkg.version}.md`) ? read(`RELEASE_${pkg.version}.md`) : '';
const originalRelease = exists('RELEASE_3.5.93.md') ? read('RELEASE_3.5.93.md') : '';
const validationStart = appJs.indexOf('function validateRoutingDraftBeforeApply');
const validationEnd = appJs.indexOf('function renderRoutingApplyStatus', validationStart);
const validationBody = validationStart >= 0 && validationEnd > validationStart ? appJs.slice(validationStart, validationEnd) : '';
const applyStart = appJs.indexOf('async function applyRoutingDrafts');
const applyEnd = appJs.indexOf('async function undoLastRoutingApply', applyStart);
const applyBody = applyStart >= 0 && applyEnd > applyStart ? appJs.slice(applyStart, applyEnd) : '';
const conflictStart = appJs.indexOf('function routingConflictExplanation');
const conflictEnd = appJs.indexOf('function classifyRoutingDraft', conflictStart);
const conflictBody = conflictStart >= 0 && conflictEnd > conflictStart ? appJs.slice(conflictStart, conflictEnd) : '';

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

check('version keeps the 3.5.93+ pre-apply check active', versionAtLeast(pkg.version, '3.5.93'), pkg.version);
check('package exposes the stage 3 pre-apply check audit', pkg.scripts?.['audit:stage3-preapply-check'] === 'node tools/stage3-preapply-check-audit.js', 'npm run audit:stage3-preapply-check');

check(
  'frontend blocks invalid draft kind, empty condition, empty target, and missing target before applying',
  validationBody.includes('allowedKinds') &&
    validationBody.includes('规则类型不可用') &&
    validationBody.includes('规则目标为空') &&
    validationBody.includes('线路目标为空') &&
    validationBody.includes('目标不存在') &&
    validationBody.includes('routingTargetOptions().some'),
  'frontend draft shape/target validation'
);

check(
  'blocking conflicts cannot be applied',
  conflictBody.includes("level: 'bad'") &&
    validationBody.includes("classification.level === 'bad'") &&
    validationBody.includes('应用前检查未通过') &&
    applyBody.includes('if (!precheckRoutingDraftsBeforeApply()) return null') &&
    !applyBody.includes('verifyAllRoutingDrafts();'),
  'bad conflict gate before background job'
);

check(
  'blocking state is visible to users',
  appJs.includes('下一步：先修正，不能应用') &&
    appJs.includes('条不能应用') &&
    styles.includes('.routing-draft-preview.bad') &&
    styles.includes('.routing-draft-row.bad'),
  'bad state UI'
);

check(
  'backend still validates targets as second gate',
  mainRs.includes('normalize_routing_draft_rule') &&
    mainRs.includes('routing_rule_target_exists(targets, &target)') &&
    mainRs.includes('Routing preflight failed') &&
    mainRs.includes('config_pipeline::preflight_profile_source'),
  'backend target validation/preflight'
);

check(
  'release audit knows the stage 3 pre-apply check gate',
  releaseAudit.includes('stage 3 pre-apply check audit script exists') &&
    releaseAudit.includes('tools/stage3-preapply-check-audit.js') &&
    releaseAudit.includes('audit:stage3-preapply-check'),
  'tools/release-audit.js'
);

check(
  'release history records 3.5.93 pre-apply check and current release keeps verification',
  originalRelease.includes('3.5.93') &&
    originalRelease.includes('规则应用前检查') &&
    release.includes('目标不存在') &&
    release.includes('npm run audit:stage3-preapply-check'),
  `RELEASE_3.5.93.md / RELEASE_${pkg.version}.md`
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
