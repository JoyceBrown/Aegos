import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = [];
const pass = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok: Boolean(ok), detail });
}

const pkg = readJson('package.json');
const mainRs = read('src-tauri/src/main.rs');
const appJs = read('src/app.js');
const releaseAudit = read('tools/release-audit.js');

const routingStart = mainRs.indexOf('fn routing_snapshot');
const routingEnd = mainRs.indexOf('#[tauri::command]', routingStart + 1);
const routingBody = routingStart >= 0 ? mainRs.slice(routingStart, routingEnd > routingStart ? routingEnd : undefined) : '';
const renderStart = appJs.indexOf('function renderRoutingSnapshot');
const renderEnd = appJs.indexOf('async function refreshRoutingSnapshot', renderStart);
const renderBody = renderStart >= 0 ? appJs.slice(renderStart, renderEnd > renderStart ? renderEnd : undefined) : '';

check('package version keeps 3.x routing foundation active', /^3\.\d+\.\d+$/.test(pkg.version), pkg.version);
check('routing targets audit is exposed as package script', pkg.scripts?.['audit:routing-targets'] === 'node tools/routing-targets-audit.js', 'npm run audit:routing-targets');
check('target catalog includes groups, proxies, and built-in policy targets', mainRs.includes('fn routing_rule_target_catalog') && mainRs.includes('yaml_sequence(config, "proxy-groups")') && mainRs.includes('yaml_sequence(config, "proxies")') && mainRs.includes('fn routing_rule_builtin_targets') && mainRs.includes('"DIRECT"') && mainRs.includes('"REJECT-DROP"'), 'target catalog');
check('missing targets are marked on rule records', mainRs.includes('fn validate_routing_rule_targets') && mainRs.includes('"targetExists"') && mainRs.includes('"targetKind"') && mainRs.includes('"missing-target"') && mainRs.includes('target is not present in active profile'), 'rule target validation');
check('routing snapshot exposes missing target summary without writing config', routingBody.includes('"missingRuleTargets": missing_rule_targets') && routingBody.includes('"missingRuleTargets": missing_rule_target_count') && !routingBody.includes('atomic_write') && !routingBody.includes('PATCH'), 'snapshot summary');
check('unit coverage reports a missing group and accepts built-ins', mainRs.includes('routing_rule_target_validation_reports_missing_targets') && mainRs.includes('MissingGroup') && mainRs.includes('MATCH,DIRECT'), 'unit test coverage');
check('frontend displays validation status from structured rule records', renderBody.includes('routingStatusLabel(item)') && renderBody.includes('routingTargetLabel(item.target)') && appJs.includes('item.missingTarget') && appJs.includes('item.orderIssue'), 'frontend status render');
check('routing remains read-only with no mutation command', !mainRs.includes('save_routing_rule') && !mainRs.includes('update_routing_rule') && !appJs.includes('saveRoutingRule'), 'no rule mutation');
check('release audit knows routing targets audit exists', releaseAudit.includes('routing targets audit script exists') && releaseAudit.includes('tools/routing-targets-audit.js'), 'release-audit');
check('audit file exists', exists('tools/routing-targets-audit.js'), 'tools/routing-targets-audit.js');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
