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

check('package version is 3.2.3 for rule order checkpoint', pkg.version === '3.2.3', pkg.version);
check('routing order audit is exposed as package script', pkg.scripts?.['audit:routing-order'] === 'node tools/routing-order-audit.js', 'npm run audit:routing-order');
check('backend detects duplicate, conflicting, and unreachable rules', mainRs.includes('fn detect_routing_rule_order_issues') && mainRs.includes('"duplicate-rule"') && mainRs.includes('"conflicting-target"') && mainRs.includes('"unreachable-after-match"'), 'order detector');
check('rule records carry order issue metadata', mainRs.includes('fn set_routing_rule_order_issue') && mainRs.includes('"orderIssue"') && mainRs.includes('"firstIndex"'), 'order issue metadata');
check('routing snapshot exposes order issue summary without writes', routingBody.includes('"ruleOrderIssues": rule_order_issues') && routingBody.includes('"ruleOrderIssues": rule_order_issue_count') && !routingBody.includes('atomic_write') && !routingBody.includes('PATCH'), 'snapshot order summary');
check('unit coverage exercises all order issue classes', mainRs.includes('routing_rule_order_detection_reports_duplicates_conflicts_and_unreachable') && mainRs.includes('DOMAIN-SUFFIX,example.com,DIRECT') && mainRs.includes('DOMAIN-SUFFIX,later.example,Proxy'), 'unit coverage');
check('frontend shows order issue details safely', renderBody.includes('item.orderIssue?.detail') && renderBody.includes('textContent') && !renderBody.includes('innerHTML'), 'frontend order details');
check('routing remains read-only with no mutation command', !mainRs.includes('save_routing_rule') && !mainRs.includes('update_routing_rule') && !appJs.includes('saveRoutingRule'), 'no rule mutation');
check('release audit knows routing order audit exists', releaseAudit.includes('routing order audit script exists') && releaseAudit.includes('tools/routing-order-audit.js'), 'release-audit');
check('audit file exists', exists('tools/routing-order-audit.js'), 'tools/routing-order-audit.js');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
