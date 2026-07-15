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
const styles = read('src/styles.css');
const releaseAudit = read('tools/release-audit.js');
const interactionSmoke = read('tools/interaction-smoke.js');
const release = exists(`RELEASE_${pkg.version}.md`) ? read(`RELEASE_${pkg.version}.md`) : '';

const uiStart = appJs.indexOf("id: 'routingRuleTestCard'");
const uiEnd = appJs.indexOf("id: 'routingApplyStatus'", uiStart);
const uiBody = uiStart >= 0 && uiEnd > uiStart ? appJs.slice(uiStart, uiEnd) : '';
const testStart = appJs.indexOf('function testRoutingWebsiteRule');
const testEnd = appJs.indexOf('function renderRoutingDraftPreview', testStart);
const testBody = testStart >= 0 && testEnd > testStart ? appJs.slice(testStart, testEnd) : '';
const matcherStart = appJs.indexOf('function routingRuleMatchesWebsite');
const matcherEnd = appJs.indexOf('function renderRoutingDraftPreview', matcherStart);
const matcherBody = matcherStart >= 0 && matcherEnd > matcherStart ? appJs.slice(matcherStart, matcherEnd) : '';

check('version keeps the 3.5.98+ rule test checkpoint active', versionAtLeast(pkg.version, '3.5.98'), pkg.version);
check('package exposes the stage 3 rule test audit', pkg.scripts?.['audit:stage3-rule-test'] === 'node tools/stage3-rule-test-audit.js', 'npm run audit:stage3-rule-test');

check(
  'rules page has a plain rule test card',
  uiBody.includes('规则测试') &&
    uiBody.includes('routingRuleTestInput') &&
    uiBody.includes('testRoutingRuleBtn') &&
    uiBody.includes('routingRuleTestResult') &&
    uiBody.includes('只读测试，不改配置、不切节点') &&
    appJs.includes("$('#testRoutingRuleBtn')?.addEventListener('click', testRoutingWebsiteRule)") &&
    appJs.includes("$('#routingRuleTestInput')?.addEventListener('keydown'"),
  'rule test card and events'
);

check(
  'rule test matches website rules without backend mutation',
  matcherBody.includes('normalizeWebsiteRuleInput') &&
    matcherBody.includes('routingRuleMatchesWebsite') &&
    matcherBody.includes("kind === 'DOMAIN'") &&
    matcherBody.includes("kind === 'DOMAIN-SUFFIX'") &&
    matcherBody.includes("kind === 'DOMAIN-KEYWORD'") &&
    matcherBody.includes('existingRoutingRules()') &&
    !matcherBody.includes('runBackgroundJob') &&
    !matcherBody.includes('invoke(') &&
    !matcherBody.includes('applyRoutingRuleEdit'),
  'read-only front-end match'
);

check(
  'rule test explains hit, miss, and system-protection cases in user language',
  matcherBody.includes('暂未命中具体网站规则') &&
    matcherBody.includes('将走') &&
    matcherBody.includes('系统保护规则') &&
    matcherBody.includes('用户规则优先') &&
    matcherBody.includes('不会改配置、不切节点'),
  'ordinary-user result copy'
);

check(
  'rule test layout is constrained for small windows',
  styles.includes('.routing-test-form') &&
    styles.includes('grid-template-columns: minmax(180px, 1fr) auto'),
  'routing test CSS'
);

check(
  'interaction smoke covers a concrete rule test hit',
  interactionSmoke.includes('routingRuleTestInput') &&
    interactionSmoke.includes('www.example.com') &&
    interactionSmoke.includes('routingRuleTestResult') &&
    interactionSmoke.includes('GLOBAL'),
  'interaction smoke rule test'
);

check(
  'release audit and release note record the 3.5.98 gate',
  releaseAudit.includes('stage 3 rule test audit script exists') &&
    releaseAudit.includes('tools/stage3-rule-test-audit.js') &&
    releaseAudit.includes('audit:stage3-rule-test') &&
    release.includes('3.5.98') &&
    release.includes('规则测试按钮') &&
    release.includes('npm run audit:stage3-rule-test') &&
    release.includes('Source-only'),
  `RELEASE_${pkg.version}.md`
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
