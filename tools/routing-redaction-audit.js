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

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

const pkg = readJson('package.json');
const appJs = read('src/app.js');
const mainRs = read('src-tauri/src/main.rs');
const releaseAudit = read('tools/release-audit.js');
const securityAudit = read('tools/security-hotfix-audit.js');

const routingStart = mainRs.indexOf('fn routing_snapshot');
const routingEnd = mainRs.indexOf('#[tauri::command]', routingStart + 1);
const routingBody = routingStart >= 0 ? mainRs.slice(routingStart, routingEnd > routingStart ? routingEnd : undefined) : '';
const renderStart = appJs.indexOf('function renderRoutingSnapshot');
const renderEnd = appJs.indexOf('async function refreshRoutingSnapshot', renderStart);
const renderBody = renderStart >= 0 ? appJs.slice(renderStart, renderEnd > renderStart ? renderEnd : undefined) : '';

check('package version remains within the 3.1 routing redaction lane', /^3\.1\.\d+$/.test(pkg.version), pkg.version);
check('routing snapshot sanitizes recent rule names', routingBody.includes('let rule = sanitize_sensitive_text') && routingBody.includes('.get("rule")'), 'rule redaction');
check('routing snapshot sanitizes recent chain names', routingBody.includes('let chains = sanitize_sensitive_text') && routingBody.includes('.get("chains")'), 'chain redaction');
check('routing frontend renders recent rules through text nodes', renderBody.includes('textContent: item.rule') && renderBody.includes('textContent: item.chains') && !renderBody.includes('innerHTML'), 'safe rule rendering');
check('routing redaction shares the global sensitive data sanitizer', mainRs.includes('fn sanitize_sensitive_text') && securityAudit.includes('logs and public subscription metadata are sanitized'), 'shared sanitizer');
check('routing redaction audit is wired into release gate', releaseAudit.includes('routing redaction audit script exists'), 'release-audit');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
