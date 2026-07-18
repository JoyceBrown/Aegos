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
const indexHtml = read('src/index.html');
const mainRs = read('src-tauri/src/main.rs');
const releaseAudit = read('tools/release-audit.js');
const release = exists(`RELEASE_${pkg.version}.md`) ? read(`RELEASE_${pkg.version}.md`) : '';

const renderStart = appJs.indexOf('function renderNodeTargetEditor');
const renderEnd = appJs.indexOf('async function openNodeGroupTargetEditor', renderStart);
const renderBody = renderStart >= 0 && renderEnd > renderStart ? appJs.slice(renderStart, renderEnd) : '';
const addStart = appJs.indexOf('async function addNodeTargetRuleFromEditor');
const addEnd = appJs.indexOf('async function deleteNodeTargetRuleFromEditor', addStart);
const addBody = addStart >= 0 && addEnd > addStart ? appJs.slice(addStart, addEnd) : '';
const deleteStart = appJs.indexOf('async function deleteNodeTargetRuleFromEditor');
const deleteEnd = appJs.indexOf('function handleNodeTargetEditorClick', deleteStart);
const deleteBody = deleteStart >= 0 && deleteEnd > deleteStart ? appJs.slice(deleteStart, deleteEnd) : '';
const clickStart = appJs.indexOf("$('#nodeRows').addEventListener('click'");
const clickEnd = appJs.indexOf("document.querySelector('.node-table')", clickStart);
const clickBody = clickStart >= 0 && clickEnd > clickStart ? appJs.slice(clickStart, clickEnd) : '';
const targetOptionsStart = appJs.indexOf('function routingTargetOptionsFull');
const targetOptionsEnd = appJs.indexOf('function optionNodes', targetOptionsStart);
const targetOptionsBody = targetOptionsStart >= 0 && targetOptionsEnd > targetOptionsStart ? appJs.slice(targetOptionsStart, targetOptionsEnd) : '';

check('version keeps the 3.5.97+ node/rule link checkpoint active', versionAtLeast(pkg.version, '3.5.97'), pkg.version);
check('package exposes the stage 3 node/rule link audit', pkg.scripts?.['audit:stage3-node-rule-link'] === 'node tools/stage3-node-rule-link-audit.js', 'npm run audit:stage3-node-rule-link');

check(
  'node rows expose a clear rule action without removing speed/edit/favorite',
  appJs.includes("dataset: { nodeAction: 'test'") &&
    appJs.includes("dataset: { nodeAction: 'edit'") &&
    appJs.includes("dataset: { nodeAction: 'route'") &&
    appJs.includes("dataset: { nodeAction: 'favorite'") &&
    appJs.includes("ariaLabel: '为网站使用此节点'") &&
    appJs.includes("icon('icon-routing')") &&
    indexHtml.includes('<span>规则</span><span>收藏</span>') &&
    styles.includes('repeat(4, 1fr)') &&
    styles.includes('140px'),
  'node row route action'
);

check(
  'node action opens the same target editor in node mode',
  appJs.includes('async function manageNodeTargets') &&
    appJs.includes("openNodeGroupTargetEditor(name, 'node')") &&
    clickBody.includes("actionButton.dataset.nodeAction === 'route'") &&
    clickBody.includes('void manageNodeTargets(name)') &&
    renderBody.includes("targetType === 'node'") &&
    renderBody.includes('targetLabel'),
  'node target editor path'
);

check(
  'node-specific rule creation uses the real routing deployment command',
  addBody.includes("runBackgroundJob('applyRoutingRuleEdit'") &&
    addBody.includes("action: 'add'") &&
    addBody.includes('target: groupName') &&
    addBody.includes('await refreshRoutingSnapshot()') &&
    mainRs.includes('fn apply_user_rule_store_edit') &&
    mainRs.includes('stage_routing_store_transaction') &&
    mainRs.includes('hot_reload_runtime_plan'),
  'applyRoutingRuleEdit add path'
);

check(
  'node-specific rules can be deleted through the same real rule path',
  deleteBody.includes("runBackgroundJob('applyRoutingRuleEdit'") &&
    deleteBody.includes("action: 'delete'") &&
    deleteBody.includes('await refreshRoutingSnapshot()') &&
    deleteBody.includes('targetType'),
  'applyRoutingRuleEdit delete path'
);

check(
  'node names are valid rule targets through routing target options',
  targetOptionsBody.includes('group.items') &&
    targetOptionsBody.includes('item.name') &&
    targetOptionsBody.includes("itemName !== 'GLOBAL'") &&
    targetOptionsBody.includes("itemName !== 'Aegos Landing IP'") &&
    targetOptionsBody.includes('targets.set(itemName, itemName)'),
  'routingTargetOptionsFull includes proxy node names'
);

check(
  'node link UX explains that the current connection is not switched',
  renderBody.includes('不会切换当前连接') &&
    renderBody.includes('用户规则优先') &&
    renderBody.includes('还没有网站指定到这个') &&
    appJs.includes('nodeTargetRuleConflict') &&
    appJs.includes('用户规则优先'),
  'ordinary-user copy and conflict check'
);

check(
  'release audit and release note record the 3.5.97 gate',
  releaseAudit.includes('stage 3 node/rule link audit script exists') &&
    releaseAudit.includes('tools/stage3-node-rule-link-audit.js') &&
    releaseAudit.includes('audit:stage3-node-rule-link') &&
    release.includes('3.5.97') &&
    release.includes('节点页和规则页联动') &&
    release.includes('npm run audit:stage3-node-rule-link'),
  `RELEASE_${pkg.version}.md`
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
