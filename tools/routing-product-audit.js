import fs from 'fs';
import path from 'path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const mainRs = read('src-tauri/src/main.rs');
const appJs = read('src/app.js');
const stylesCss = read('src/styles.css');
const releaseAudit = read('tools/release-audit.js');
const exists = (file) => fs.existsSync(path.join(root, file));
const acceptanceStandard = exists('ROUTING_PAGE_REAL_USER_ACCEPTANCE_STANDARD.md')
  ? read('ROUTING_PAGE_REAL_USER_ACCEPTANCE_STANDARD.md')
  : '';
const executionRecord = exists('ROUTING_PAGE_REAL_USER_EXECUTION_RECORD.md')
  ? read('ROUTING_PAGE_REAL_USER_EXECUTION_RECORD.md')
  : '';
const maturityPlan = read('PRODUCT_MATURITY_RECOVERY_PLAN.md');
const maturityGap = read('PRODUCT_MATURITY_GAP_REPORT.md');

const failures = [];
const pass = [];

function check(name, ok, detail = '') {
  if (ok) pass.push(name);
  else failures.push(`${name}${detail ? ` (${detail})` : ''}`);
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

check('version is at least 3.4.16 routing productization checkpoint', versionAtLeast(pkg.version, '3.4.16'), pkg.version);
check(
  'backend exposes constrained routing apply and undo commands',
  mainRs.includes('fn apply_routing_drafts(') &&
    mainRs.includes('fn undo_last_routing_apply(') &&
    mainRs.includes('apply_routing_drafts,') &&
    mainRs.includes('undo_last_routing_apply,'),
  'apply_routing_drafts/undo_last_routing_apply'
);
check(
  'routing apply is available through background job model',
  mainRs.includes('"applyRoutingDrafts"') &&
    mainRs.includes('"undoRoutingApply"') &&
    appJs.includes("runBackgroundJob('applyRoutingDrafts'") &&
    appJs.includes("runBackgroundJob('undoRoutingApply'"),
  'background job kinds'
);
check(
  'draft writes are constrained to generated structured rules',
  mainRs.includes('struct RoutingDraftInput') &&
    mainRs.includes('fn normalize_routing_draft_rule') &&
    mainRs.includes('allowed.contains(&kind.as_str())') &&
    mainRs.includes('validate_routing_rule_part') &&
    mainRs.includes('routing_rule_target_exists(targets, &target)'),
  'structured draft validation'
);
check(
  'routing apply preflights before atomic profile write',
  mainRs.indexOf('preflight_runtime_config(&patched, &profile, &settings)') > -1 &&
    mainRs.indexOf('preflight_runtime_config(&patched, &profile, &settings)') <
      mainRs.indexOf('atomic_write_text_confined(&profile_path, &self.profile_dir, &next_raw)'),
  'preflight before write'
);
check(
  'routing apply stores rollback backup inside app data',
  mainRs.includes('routing-last-apply-backup.yaml') &&
    mainRs.includes('routing-last-apply-backup.json') &&
    mainRs.includes('atomic_write_text_confined(&backup_path, &self.app_data, &previous_raw)') &&
    mainRs.includes('remove_file_confined(&backup_path, &self.app_data)'),
  'app-data backup'
);
check(
  'routing apply hot reload failure restores previous profile',
  mainRs.includes('let restore_file =') &&
    mainRs.includes('atomic_write_text_confined(&profile_path, &self.profile_dir, &previous_raw)') &&
    mainRs.includes('分流规则热重载失败，已回滚当前配置'),
  'hot reload rollback'
);
check(
  'frontend exposes verify, apply, and undo as clear user actions',
  appJs.includes('verifyAllRoutingDraftsBtn') &&
    appJs.includes('applyRoutingDraftsBtn') &&
    appJs.includes('undoRoutingApplyBtn') &&
    appJs.includes('function verifyAllRoutingDrafts') &&
    appJs.includes('function applyRoutingDrafts') &&
    appJs.includes('function undoLastRoutingApply'),
  'routing draft actions'
);
check(
  'routing draft UI makes unapplied state explicit',
  (appJs.includes('未生效') || appJs.includes('\\u672a\\u751f\\u6548')) &&
    (appJs.includes('下一步') || appJs.includes('\\u4e0b\\u4e00\\u6b65')) &&
    (appJs.includes('可应用') || appJs.includes('\\u53ef\\u5e94\\u7528')) &&
    stylesCss.includes('.routing-draft-actions'),
  'draft state labels'
);
check(
  'routing user input is not rendered through dangerous HTML APIs',
  !appJs.includes('innerHTML') &&
    !appJs.includes('insertAdjacentHTML') &&
    !appJs.includes('outerHTML'),
  'textContent/createElement only'
);
check(
  'routing apply result is visible and user rules are backed by snapshot metadata',
  appJs.includes('routingApplyStatus') &&
    appJs.includes('renderRoutingApplyStatus') &&
    appJs.includes('data.lastApply') &&
    appJs.includes('summary.userRuleCount') &&
    mainRs.includes('fn routing_apply_metadata') &&
    mainRs.includes('fn mark_last_applied_routing_rules') &&
    mainRs.includes('"source".to_string(), json!("user")') &&
    mainRs.includes('"lastApply"'),
  'apply status/user rule metadata'
);
check(
  'strategy groups are edited from node page while routing page stays a read-only chooser',
  mainRs.includes('struct RoutingGroupEditInput') &&
    mainRs.includes('fn apply_routing_group_edit') &&
    mainRs.includes('"applyRoutingGroupEdit"') &&
    appJs.includes("runBackgroundJob('applyRoutingGroupEdit'") &&
    appJs.includes('renderRoutingGroupSummaryForRules') &&
    appJs.includes('routing-group-guide') &&
    appJs.includes("dataset: { pageJump: 'nodes' }") &&
    appJs.includes('function openNodeGroupContextMenu') &&
    appJs.includes('function openNodeGroupMemberEditor') &&
    appJs.includes('function openNodeGroupTargetEditor') &&
    !appJs.includes('routingGroupForm') &&
    !appJs.includes('data-edit-routing-group') &&
    !appJs.includes('data-delete-routing-group'),
  'node page owns strategy group add/edit/delete; routing page only links there'
);
check(
  'routing page exposes editable Aegos user rules but keeps system rules read-only',
  mainRs.includes('routing-user-rules.json') &&
    mainRs.includes('fn apply_routing_rule_edit') &&
    mainRs.includes('fn mark_system_routing_rules') &&
    mainRs.includes('"editable".to_string(), json!(false)') &&
    appJs.includes('routingRuleForm') &&
    appJs.includes("runBackgroundJob('applyRoutingRuleEdit'") &&
    appJs.includes('routing-readonly-pill') &&
    appJs.includes('renderRoutingSystemWorkbench'),
  'user rules editable/system rules read-only'
);
check(
  'release audit includes routing product gate',
  releaseAudit.includes("audit:routing-product") &&
    releaseAudit.includes('routing productization gate'),
  'release audit gate'
);
check(
  'old routing productization plan is removed',
  !exists('ROUTING_PRODUCTIZATION_RECOVERY_PLAN.md') &&
    !maturityPlan.includes('ROUTING_PRODUCTIZATION_RECOVERY_PLAN.md') &&
    !maturityGap.includes('ROUTING_PRODUCTIZATION_RECOVERY_PLAN.md'),
  'old routing plan must not be used as an escape hatch'
);
check(
  'hard real-user acceptance standard exists and is the top routing gate',
  acceptanceStandard.includes('真实用户验收') &&
    acceptanceStandard.includes('一票否决') &&
    acceptanceStandard.includes('禁止绕行') &&
    acceptanceStandard.includes('截图验收') &&
    acceptanceStandard.includes('本标准后续可以变得更严格，但不能变得更宽松'),
  'ROUTING_PAGE_REAL_USER_ACCEPTANCE_STANDARD.md'
);
check(
  'maturity plans point to hard routing standard',
  maturityPlan.includes('ROUTING_PAGE_REAL_USER_ACCEPTANCE_STANDARD.md') &&
    maturityGap.includes('ROUTING_PAGE_REAL_USER_ACCEPTANCE_STANDARD.md'),
  'product maturity docs must reference the hard routing gate'
);
check(
  'real-user execution record exists and starts from an explicit failed baseline',
  executionRecord.includes('真实用户执行记录') &&
    executionRecord.includes('本轮开始时分流页判定为未通过真实用户验收') &&
    executionRecord.includes('真实用户路径验收记录') &&
    executionRecord.includes('候选通过') &&
    executionRecord.includes('真实 Tauri 安装包环境'),
  'execution record must not pretend old work passed'
);
check(
  'routing assistant is task-focused instead of three cramped parallel cards',
  appJs.includes("className: 'routing-kind-list'") &&
    appJs.includes('data-routing-kind') &&
    appJs.includes('data-routing-panel') &&
    appJs.includes('function setRoutingAssistantKind') &&
    appJs.includes("kindButton('website'") &&
    appJs.includes("kindButton('app'") &&
    appJs.includes("kindButton('region'"),
  'website/app/scene task selector'
);
check(
  'advanced engineering data is folded by default below the main task',
  appJs.includes("el('details', { id: 'routingAdvancedPanel'") &&
    appJs.includes("className: 'routing-advanced-note'") &&
    appJs.includes('tables[0]') &&
    appJs.includes('tables[1]') &&
    stylesCss.includes('.routing-advanced-panel') &&
    stylesCss.includes('.routing-advanced-summary') &&
    stylesCss.includes('.routing-advanced-note') &&
    stylesCss.includes('min-height: 56px') &&
    stylesCss.includes('.routing-advanced-summary:focus-visible') &&
    !appJs.includes("className: 'routing-draft-card routing-website-card'"),
  'advanced table panel'
);
check(
  'routing layout has responsive anti-overlap rules',
  stylesCss.includes('.routing-builder') &&
    stylesCss.includes('grid-template-columns: 210px minmax(0, 1fr)') &&
    stylesCss.includes('@media (max-width: 980px)') &&
    stylesCss.includes('@media (max-width: 760px)') &&
    stylesCss.includes('.routing-draft-row') &&
    stylesCss.includes('.routing-draft-main') &&
    stylesCss.includes('grid-template-columns: minmax(220px, 1fr) 76px 64px 64px 64px') &&
    stylesCss.includes('overflow-y: auto') &&
    stylesCss.includes('scrollbar-gutter: stable'),
  'responsive routing layout'
);
check(
  'settings takeover controls cannot leak into routing summary',
  appJs.includes("document.querySelector('[data-page-panel=\"settings\"] .settings-summary-grid')") &&
    !appJs.includes("document.querySelector('.settings-summary-grid')"),
  'settings controls must be scoped to settings page'
);

const result = { ok: failures.length === 0, failed: failures, passed: pass };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
