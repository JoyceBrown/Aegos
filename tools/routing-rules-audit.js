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
const indexHtml = read('src/index.html');
const releaseAudit = read('tools/release-audit.js');

const routingStart = mainRs.indexOf('fn routing_snapshot');
const routingEnd = mainRs.indexOf('#[tauri::command]', routingStart + 1);
const routingBody = routingStart >= 0 ? mainRs.slice(routingStart, routingEnd > routingStart ? routingEnd : undefined) : '';
const renderStart = appJs.indexOf('function renderRoutingSnapshot');
const renderEnd = appJs.indexOf('async function refreshRoutingSnapshot', renderStart);
const renderBody = renderStart >= 0 ? appJs.slice(renderStart, renderEnd > renderStart ? renderEnd : undefined) : '';

check('package version keeps 3.x routing foundation active', /^3\.\d+\.\d+$/.test(pkg.version), pkg.version);
check('routing rules audit is exposed as package script', pkg.scripts?.['audit:routing-rules'] === 'node tools/routing-rules-audit.js', 'npm run audit:routing-rules');
check('backend parses profile rules into structured records', mainRs.includes('fn split_rule_segments') && mainRs.includes('fn parse_routing_rule_text') && mainRs.includes('fn routing_rules_for_profile') && mainRs.includes('"condition"') && mainRs.includes('"target"') && mainRs.includes('"options"'), 'rule parser functions');
check('rule parser handles nested logical commas and no-resolve options', mainRs.includes('routing_rule_parser_structures_common_rules') && mainRs.includes('AND,((DOMAIN-SUFFIX,example.com),(NETWORK,TCP)),Proxy') && mainRs.includes('GEOIP,CN,DIRECT,no-resolve'), 'parser unit coverage');
check('routing snapshot returns static rules without config writes', routingBody.includes('"rules": static_rules') && routingBody.includes('"ruleCount": rule_count') && routingBody.includes('routing_rules_for_profile(active_profile.as_ref())') && !routingBody.includes('atomic_write') && !routingBody.includes('PATCH'), 'read-only snapshot');
check('routing frontend renders structured rules safely', renderBody.includes('const rules = Array.isArray(data.rules)') && renderBody.includes('item.condition') && renderBody.includes('item.target') && renderBody.includes('replaceChildrenSafe') && !renderBody.includes('innerHTML'), 'safe structured render');
check('routing table labels match structured rule fields', indexHtml.includes('<span>&#35268;&#21017;&#25968;</span><b id="routingRuleHitCount">-</b>') && indexHtml.includes('<span>&#31867;&#22411;</span><span>&#26465;&#20214;</span><span>&#30446;&#26631;</span><span>&#29366;&#24577;</span><span>&#35828;&#26126;</span>'), 'rule table labels');
check('routing remains read-only with no mutation command', !mainRs.includes('save_routing_rule') && !mainRs.includes('update_routing_rule') && !appJs.includes('saveRoutingRule'), 'no rule mutation');
check('release audit knows routing rules audit exists', releaseAudit.includes('routing rules audit script exists') && releaseAudit.includes('tools/routing-rules-audit.js'), 'release-audit');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
