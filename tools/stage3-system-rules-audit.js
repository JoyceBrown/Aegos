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

const pkg = JSON.parse(read('package.json'));
const appJs = read('src/app.js');
const mainRs = read('src-tauri/src/main.rs');
const releaseAudit = read('tools/release-audit.js');
const release = exists(`RELEASE_${pkg.version}.md`) ? read(`RELEASE_${pkg.version}.md`) : '';
const bucketsStart = appJs.indexOf('function routingSystemRuleBuckets');
const bucketsEnd = appJs.indexOf('function routingTargetOptionsFull', bucketsStart);
const bucketsBody = bucketsStart >= 0 && bucketsEnd > bucketsStart ? appJs.slice(bucketsStart, bucketsEnd) : '';
const renderStart = appJs.indexOf('function renderRoutingSystemWorkbench');
const renderEnd = appJs.indexOf('function renderRoutingGroupSummaryForRules', renderStart);
const renderBody = renderStart >= 0 && renderEnd > renderStart ? appJs.slice(renderStart, renderEnd) : '';
const markStart = mainRs.indexOf('fn mark_system_routing_rules');
const markEnd = mainRs.indexOf('fn routing_rule_target_exists', markStart);
const markBody = markStart >= 0 && markEnd > markStart ? mainRs.slice(markStart, markEnd) : '';

check('version keeps the 3.5.96+ system-rule explanation checkpoint active', versionAtLeast(pkg.version, '3.5.96'), pkg.version);
check('package exposes the stage 3 system rules audit', pkg.scripts?.['audit:stage3-system-rules'] === 'node tools/stage3-system-rules-audit.js', 'npm run audit:stage3-system-rules');

check(
  'backend marks system rules with user-facing explanation metadata',
  markBody.includes('"systemRuleKind"') &&
    markBody.includes('"outbound-ip"') &&
    markBody.includes('"userImpact"') &&
    markBody.includes('"lockedReason"') &&
    markBody.includes('does not switch nodes') &&
    mainRs.includes('"systemRuleKind": "outbound-ip"') &&
    mainRs.includes('"lockedReason": "System protection rule'),
  'system metadata'
);

check(
  'frontend explains system rules by ordinary-user purpose',
  bucketsBody.includes('落地 IP 查询') &&
    bucketsBody.includes('Aegos 自身服务') &&
    bucketsBody.includes('防泄漏保护') &&
    bucketsBody.includes('不会切换节点') &&
    bucketsBody.includes('普通用户规则不能覆盖这类保护'),
  'three system explanation buckets'
);

check(
  'system rule details remain read-only and explain impact instead of exposing raw YAML first',
  bucketsBody.includes('function routingSystemRuleExplanation') &&
    renderBody.includes('routingSystemRuleExplanation(item)') &&
    renderBody.includes('系统规则只解释和展示，不允许编辑；用户规则仍然优先。') &&
    renderBody.includes('只读') &&
    !renderBody.includes('dataset: { editRoutingRule') &&
    !renderBody.includes('dataset: { deleteRoutingRule'),
  'read-only detail UX'
);

check(
  'release audit and release note record the 3.5.96 gate',
  releaseAudit.includes('stage 3 system rules audit script exists') &&
    releaseAudit.includes('tools/stage3-system-rules-audit.js') &&
    releaseAudit.includes('audit:stage3-system-rules') &&
    release.includes('3.5.96') &&
    release.includes('系统规则解释') &&
    release.includes('npm run audit:stage3-system-rules'),
  `RELEASE_${pkg.version}.md`
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
