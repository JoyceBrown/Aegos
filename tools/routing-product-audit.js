import fs from 'fs';
import path from 'path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const mainRs = read('src-tauri/src/main.rs');
const appJs = read('src/app.js');
const stylesCss = read('src/styles.css');
const releaseAudit = read('tools/release-audit.js');

const failures = [];
const pass = [];

function check(name, ok, detail = '') {
  if (ok) pass.push(name);
  else failures.push(`${name}${detail ? ` (${detail})` : ''}`);
}

check('version is at least 3.4.16 routing productization checkpoint', /^3\.4\.(1[6-9]|20)$/.test(pkg.version), pkg.version);
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
  mainRs.includes('let restore_file = atomic_write_text_confined(&profile_path, &self.profile_dir, &previous_raw)') &&
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
  'release audit includes routing product gate',
  releaseAudit.includes("audit:routing-product") &&
    releaseAudit.includes('routing productization gate'),
  'release audit gate'
);

const result = { ok: failures.length === 0, failed: failures, passed: pass };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
