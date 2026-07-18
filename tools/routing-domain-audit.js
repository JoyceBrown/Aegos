import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
const main = read('src-tauri', 'src', 'main.rs');
const domain = read('src-tauri', 'src', 'routing_domain.rs');
const pkg = JSON.parse(read('package.json'));

const passed = [];
const failed = [];
const check = (name, ok, detail = '') => (ok ? passed : failed).push({ name, ok, detail });
const section = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  return from >= 0 && to > from ? source.slice(from, to) : '';
};

const groupEdit = section(main, 'fn apply_routing_group_edit(', 'fn apply_routing_rule_edit(');
const ruleEdit = section(main, 'fn apply_routing_rule_edit(', 'fn standby_settings(');
const draftApply = section(main, 'fn apply_routing_drafts(', 'fn undo_last_routing_apply(');
const draftCompile = section(domain, 'impl RoutingDraftInput {', 'impl RoutingRuleEditInput {');

check(
  'routing inputs and actions have one typed owner',
  main.includes('mod routing_domain;') &&
    domain.includes('pub(crate) struct RoutingDraftInput') &&
    domain.includes('pub(crate) struct RoutingGroupEditInput') &&
    domain.includes('pub(crate) struct RoutingRuleEditInput') &&
    domain.includes('pub(crate) enum RoutingGroupAction') &&
    domain.includes('pub(crate) enum RoutingRuleAction') &&
    !main.includes('struct RoutingDraftInput {') &&
    !main.includes('struct RoutingGroupEditInput {') &&
    !main.includes('struct RoutingRuleEditInput {'),
  'request decoding is stable, but arbitrary strings cannot reach YAML mutation'
);

check(
  'rule compilation and strategy validation live outside main.rs',
  draftCompile.includes('pub(crate) fn compile(') &&
    domain.includes('pub(crate) fn validate_group_type(') &&
    domain.includes('pub(crate) fn validate_group_members(') &&
    domain.includes('pub(crate) fn replace_rule_target(') &&
    main.includes('let compiled = draft.compile(targets)?;') &&
    !main.includes('fn validate_routing_group_type(') &&
    !main.includes('fn validate_routing_group_members(') &&
    !main.includes('fn routing_rule_replace_target(') &&
    !main.includes('fn validate_routing_rule_part('),
  'one compiler validates kinds, targets, options, names, group types, and members'
);

check(
  'strategy group preferences commit only after verified configuration deployment',
    groupEdit.indexOf('self.commit_profile_routing_config(&profile, &source') <
      groupEdit.indexOf('self.settings.selected_proxy_map = next_selected_map') &&
    groupEdit.includes('let previous_selected_map = self.settings.selected_proxy_map.clone();') &&
    groupEdit.includes('write_routing_user_rule_lists(') &&
    groupEdit.includes('could not update user-rule ownership') &&
    groupEdit.includes('restore_routing_transaction(') &&
    !groupEdit.includes('let _ = self.save_settings()'),
  'deployment failure leaves preferences untouched; settings failure restores config and preferences'
);

check(
  'rule ownership and batch undo records roll back with configuration',
  main.includes('fn restore_routing_transaction(') &&
    main.includes('write_routing_user_rules(&self.app_data, previous_registry)') &&
    ruleEdit.includes('let previous_registry = read_routing_user_rules(&self.app_data);') &&
    ruleEdit.includes('commit_needed,') &&
    ruleEdit.includes('could not update user-rule ownership') &&
    draftApply.includes('let previous_backup = fs::read_to_string(&backup_path).ok();') &&
    draftApply.includes('restore_optional_text_file(') &&
    draftApply.includes('could not finalize undo and ownership records'),
  'post-deploy file failures restore preferences, user ownership, active config, and prior undo evidence'
);

check(
  'rule and group edits dispatch exhaustive enums',
  groupEdit.includes('RoutingGroupAction::parse(&edit.action)?') &&
    ruleEdit.includes('RoutingRuleAction::parse(&edit.action)?') &&
    ruleEdit.includes('action.requires_existing_user_rule()') &&
    !groupEdit.includes('action.trim().to_ascii_lowercase()') &&
    !ruleEdit.includes('action.trim().to_ascii_lowercase()'),
  'unsupported operations fail before file or runtime mutation'
);

check(
  'typed routing domain has regression tests and a release gate',
  domain.includes('rule_commands_reject_unknown_actions_and_targets') &&
    domain.includes('rule_compile_and_group_validation_are_typed') &&
    pkg.scripts?.['audit:routing-domain'] === 'node tools/routing-domain-audit.js',
  'cargo tests plus npm run audit:routing-domain'
);

const result = { ok: failed.length === 0, failed, passed, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
