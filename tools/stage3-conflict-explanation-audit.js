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
const releaseAudit = read('tools/release-audit.js');
const release = exists(`RELEASE_${pkg.version}.md`) ? read(`RELEASE_${pkg.version}.md`) : '';
const classifierStart = appJs.indexOf('function routingConflictExplanation');
const classifierEnd = appJs.indexOf('function classifyRoutingDraft', classifierStart);
const classifierBody = classifierStart >= 0 && classifierEnd > classifierStart ? appJs.slice(classifierStart, classifierEnd) : '';
const nodeConflictStart = appJs.indexOf('function nodeTargetRuleConflict');
const nodeConflictEnd = appJs.indexOf('function updateNodeTargetInputHint', nodeConflictStart);
const nodeConflictBody = nodeConflictStart >= 0 && nodeConflictEnd > nodeConflictStart ? appJs.slice(nodeConflictStart, nodeConflictEnd) : '';

check('version is the 3.5.91 conflict explanation checkpoint', pkg.version === '3.5.91', pkg.version);
check('package exposes the stage 3 conflict explanation audit', pkg.scripts?.['audit:stage3-conflict-explanation'] === 'node tools/stage3-conflict-explanation-audit.js', 'npm run audit:stage3-conflict-explanation');

check(
  'rule conflicts explain user-rule priority in plain language',
  classifierBody.includes('用户规则优先') &&
    classifierBody.includes('同一个网站/应用只应保留一条明确规则') &&
    classifierBody.includes('订阅规则当前会走') &&
    classifierBody.includes('会覆盖订阅里的判断'),
  'user/config conflict wording'
);

check(
  'system protection conflicts explain why ordinary rules cannot override them',
  classifierBody.includes('系统保护规则已占用这个目标') &&
    classifierBody.includes('落地 IP 查询') &&
    classifierBody.includes('Aegos 自身服务') &&
    classifierBody.includes('防泄漏保护') &&
    classifierBody.includes('普通用户规则不能覆盖'),
  'system protection wording'
);

check(
  'node-page target editor uses the same conflict policy',
  nodeConflictBody.includes('routingRuleCategory(rule) === \'system\'') &&
    nodeConflictBody.includes('这是系统保护规则') &&
    nodeConflictBody.includes('不能用普通用户规则覆盖') &&
    nodeConflictBody.includes('用户规则优先，同一目标只保留一条'),
  'node target editor conflict policy'
);

check(
  'old scenario-rule priority wording is not exposed in the current mainline UI',
  !appJs.includes('场景规则'),
  'no 场景规则 wording'
);

check(
  'release audit knows the stage 3 conflict explanation gate',
  releaseAudit.includes('stage 3 conflict explanation audit script exists') &&
    releaseAudit.includes('tools/stage3-conflict-explanation-audit.js') &&
    releaseAudit.includes('audit:stage3-conflict-explanation'),
  'tools/release-audit.js'
);

check(
  'release note records plan and verification for 3.5.91',
  release.includes('3.5.91') &&
    release.includes('规则冲突解释') &&
    release.includes('用户规则优先') &&
    release.includes('npm run audit:stage3-conflict-explanation') &&
    release.includes('Source-only'),
  `RELEASE_${pkg.version}.md`
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
