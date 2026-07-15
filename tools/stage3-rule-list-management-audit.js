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
const mainRs = read('src-tauri/src/main.rs');
const releaseAudit = read('tools/release-audit.js');
const release = exists(`RELEASE_${pkg.version}.md`) ? read(`RELEASE_${pkg.version}.md`) : '';
const editStart = mainRs.indexOf('fn apply_routing_rule_edit');
const editEnd = mainRs.indexOf('fn standby_settings', editStart);
const editBody = editStart >= 0 && editEnd > editStart ? mainRs.slice(editStart, editEnd) : '';
const registryStart = mainRs.indexOf('fn routing_user_rule_lists');
const registryEnd = mainRs.indexOf('fn routing_rule_target', registryStart);
const registryBody = registryStart >= 0 && registryEnd > registryStart ? mainRs.slice(registryStart, registryEnd) : '';
const workbenchStart = appJs.indexOf('function renderRoutingRuleWorkbench');
const workbenchEnd = appJs.indexOf('function renderRoutingSystemWorkbench', workbenchStart);
const workbenchBody = workbenchStart >= 0 && workbenchEnd > workbenchStart ? appJs.slice(workbenchStart, workbenchEnd) : '';
const toggleStart = appJs.indexOf('async function toggleRoutingRule');
const toggleEnd = appJs.indexOf('async function refreshRoutingSnapshot', toggleStart);
const toggleBody = toggleStart >= 0 && toggleEnd > toggleStart ? appJs.slice(toggleStart, toggleEnd) : '';
const clickStart = appJs.indexOf("document.body.addEventListener('click'");
const clickEnd = appJs.indexOf("const closeButton = event.target.closest('[data-close-connection]')", clickStart);
const clickBody = clickStart >= 0 && clickEnd > clickStart ? appJs.slice(clickStart, clickEnd) : '';

check('version keeps the 3.5.95+ rule list management checkpoint active', versionAtLeast(pkg.version, '3.5.95'), pkg.version);
check('package exposes the stage 3 rule list management audit', pkg.scripts?.['audit:stage3-rule-list-management'] === 'node tools/stage3-rule-list-management-audit.js', 'npm run audit:stage3-rule-list-management');

check(
  'backend stores active and disabled user rules without breaking old array registries',
  registryBody.includes('if entry.is_array()') &&
    registryBody.includes('"active"') &&
    registryBody.includes('"disabled"') &&
    registryBody.includes('routing_disabled_user_rule_list') &&
    registryBody.includes('write_routing_user_rule_lists'),
  'active/disabled registry compatibility'
);

check(
  'backend can enable, disable, delete, edit, and reorder real user rules',
  editBody.includes('"edit" | "delete" | "enable" | "disable" | "up" | "down"') &&
    editBody.includes('"disable" =>') &&
    editBody.includes('rules.remove(index)') &&
    editBody.includes('"enable" =>') &&
    editBody.includes('rules.insert(insert_at, yaml_str(next_rule.clone()))') &&
    editBody.includes('rules.swap(index, user_indexes[target_position])') &&
    editBody.includes('commit_profile_routing_config') &&
    editBody.includes('sync_active_routing_user_rule_order'),
  'real YAML mutation and deployment path'
);

check(
  'disabled rules are visible in the shared runtime snapshot but not treated as active config',
  mainRs.includes('routing_disabled_user_rule_list(&state.app_data, &profile.id)') &&
    mainRs.includes('"enabled"') &&
    mainRs.includes('"status".to_string(), json!("disabled")') &&
    mainRs.includes('This user rule is disabled and is not in the running config.'),
  'disabled rule snapshot'
);

check(
  'frontend exposes direct list management controls without replacing page navigation',
  workbenchBody.includes('toggleRoutingRule') &&
    workbenchBody.includes('moveRoutingRule') &&
    workbenchBody.includes('toggleRoutingRuleState') &&
    workbenchBody.includes('moveRoutingRuleDirection') &&
    workbenchBody.includes('disabled: !canMoveUp') &&
    workbenchBody.includes('disabled: !canMoveDown') &&
    toggleBody.includes("runBackgroundJob('applyRoutingRuleEdit'") &&
    clickBody.includes('await toggleRoutingRule') &&
    clickBody.includes('await moveRoutingRule'),
  'enable/disable/edit/delete/order controls'
);

check(
  'disabled state is understandable and visually distinct',
  appJs.includes("item.enabled === false || item.status === 'disabled'") &&
    workbenchBody.includes('is-disabled') &&
    workbenchBody.includes('已停用') &&
    styles.includes('.routing-work-row.is-disabled'),
  'disabled row UX'
);

check(
  'release audit and release note record the 3.5.95 gate',
  releaseAudit.includes('stage 3 rule list management audit script exists') &&
    releaseAudit.includes('tools/stage3-rule-list-management-audit.js') &&
    releaseAudit.includes('audit:stage3-rule-list-management') &&
    release.includes('3.5.95') &&
    release.includes('规则列表可管理') &&
    release.includes('npm run audit:stage3-rule-list-management') &&
    release.includes('Source-only'),
  `RELEASE_${pkg.version}.md`
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
