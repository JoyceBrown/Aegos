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
const coreDomainRs = read('src-tauri/src/core_domain.rs');
const coreRuntimeRs = read('src-tauri/src/core_runtime.rs');
const releaseAudit = read('tools/release-audit.js');
const securityAudit = read('tools/security-hotfix-audit.js');

const routingStart = mainRs.indexOf('fn routing_snapshot');
const routingEnd = mainRs.indexOf('#[tauri::command]', routingStart + 1);
const routingBody = routingStart >= 0 ? mainRs.slice(routingStart, routingEnd > routingStart ? routingEnd : undefined) : '';
const renderStart = appJs.indexOf('function renderRoutingAdvancedRuleRows');
const renderEnd = appJs.indexOf('function renderRoutingSnapshot', renderStart);
const renderBody = renderStart >= 0 ? appJs.slice(renderStart, renderEnd > renderStart ? renderEnd : undefined) : '';

check('package version keeps 3.x routing redaction gate active', /^3\.\d+\.\d+$/.test(pkg.version), pkg.version);
check('routing snapshot sanitizes recent rule names', coreDomainRs.includes('let rule = sanitize(text_field(item, "rule"))') && coreRuntimeRs.includes('recent_rule_hits(&connections, limit)'), 'rule redaction');
check('routing snapshot sanitizes recent route names', coreDomainRs.includes('.get("chains")') && coreDomainRs.includes('.map(&sanitize)') && coreRuntimeRs.includes('"route": route'), 'route redaction');
check(
  'routing frontend renders structured rules through text nodes',
  renderBody.includes('textContent: item.condition') &&
    renderBody.includes('routingTargetLabel(item.target)') &&
    renderBody.includes('routingStatusLabel(item)') &&
    !renderBody.includes('innerHTML'),
  'safe rule rendering'
);
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
