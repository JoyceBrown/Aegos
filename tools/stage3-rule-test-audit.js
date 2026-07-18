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
const backendStart = mainRs.indexOf('fn test_routing_website');
const backendEnd = mainRs.indexOf('fn routing_snapshot', backendStart);
const backendBody = backendStart >= 0 && backendEnd > backendStart ? mainRs.slice(backendStart, backendEnd) : '';

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
  testBody.includes("invoke('test_routing_website'") &&
    !testBody.includes('runBackgroundJob') &&
    backendBody.includes('routing_rule_matches_domain') &&
    backendBody.includes('store.active_for_profile') &&
    backendBody.includes('routing_config_rules_for_profile') &&
    !backendBody.includes('write_') &&
    !backendBody.includes('hot_reload'),
  'read-only targeted backend match'
);

check(
  'rule test explains hit, miss, and system-protection cases in user language',
  testBody.includes('暂未命中可解释的网站规则') &&
    testBody.includes('将走') &&
    testBody.includes('系统保护规则') &&
    testBody.includes('测试只读取当前配置，不会切节点或改变连接') &&
    backendBody.includes('这是不可覆盖的系统检测规则'),
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
  interactionSmoke.includes("command === 'test_routing_website'") &&
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
    release.includes('npm run audit:stage3-rule-test'),
  `RELEASE_${pkg.version}.md`
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
