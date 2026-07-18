import fs from 'node:fs';

const main = fs.readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
const store = fs.readFileSync(new URL('../src-tauri/src/routing_store.rs', import.meta.url), 'utf8');
const domain = fs.readFileSync(new URL('../src-tauri/src/routing_domain.rs', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

const checks = [
  ['canonical user-rule store exists', store.includes('struct UserRuleStore') && main.includes('aegos-user-rules.json')],
  ['rules have stable ids and explicit scopes', store.includes('pub(crate) id: String') && store.includes('enum UserRuleScope')],
  ['legacy rules migrate into canonical records', main.includes('user_rule_record_from_legacy') && main.includes('source: "legacy"')],
  ['subscription deletion previews affected rules', main.includes('fn profile_removal_impact') && app.includes("invoke('profile_removal_impact'")],
  ['unbound rules can rebind, globalize, or delete', main.includes('fn resolve_unbound_user_rule') && app.includes('resolveUnboundRoutingRule')],
  ['missing targets stay out of runtime', main.includes('.filter(|rule| routing_domain::target_exists(&targets, &rule.target))')],
  ['website and app wizards remain task based', app.includes('routingWebsiteInput') && app.includes('routingAppInput')],
  ['service bundles are available', app.includes('previewRoutingServiceBundle') && app.includes("routingService: 'telegram'")],
  ['user priority is deterministic', store.includes('runtime_rank') && store.includes('active_for_profile')],
  ['same-scope ambiguous matchers are blocked', main.includes('当前作用范围内已有相同匹配条件')],
  ['system protection routes are non-overridable', main.includes('PROTECTED_DOMAINS') && main.includes('AEGOS_OUTBOUND_IP_GROUP')],
  ['rule writes create deployment reports', main.includes('routing-deployment-report.json') && main.includes('"status": "rolled-back"')],
  ['rule store and runtime rollback together', main.includes('storeRestored') && main.includes('runtimeRestored')],
  ['large subscription rules are paged by backend', main.includes('fn routing_rule_page') && app.includes('loadRoutingConfigRulePage')],
  ['website rule tests are targeted backend queries', main.includes('fn test_routing_website') && app.includes("invoke('test_routing_website'")],
  ['stale profile rule pages are rejected', main.includes('这一页旧规则已取消加载') && app.includes('routingConfigRuleRequestSeq')],
  ['old YAML rule mutation methods are gone', !main.includes('    fn apply_routing_drafts(') && !main.includes('    fn apply_routing_rule_edit(')],
  ['rule edit payload supports stable ids', domain.includes('pub(crate) rule_id: Option<String>') && app.includes('ruleId')]
];

const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error(`routing seven-stage audit failed: ${failed.join('; ')}`);
  process.exit(1);
}

console.log(`routing seven-stage audit passed (${checks.length}/${checks.length})`);
