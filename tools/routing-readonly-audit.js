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
const indexHtml = read('src/index.html');
const appJs = read('src/app.js');
const mainRs = read('src-tauri/src/main.rs');
const releaseAudit = read('tools/release-audit.js');
const architectureAudit = read('tools/architecture-freeze-audit.js');

check('package version keeps 3.x controlled-routing gate active', /^3\.\d+\.\d+$/.test(pkg.version), pkg.version);
check('routing page navigation and panel exist', indexHtml.includes('data-page="routing"') && indexHtml.includes('data-page-panel="routing"'), 'routing page');
check('routing page makes subscription and system read-only boundary visible', indexHtml.includes('routingReadonlyBadge') && indexHtml.includes('订阅/系统规则只读'), 'scoped read-only copy');
check('routing snapshot backend command exists', mainRs.includes('fn routing_snapshot') && mainRs.includes('routing_snapshot,'), 'routing_snapshot command');
check('routing snapshot uses typed CoreController for recent rule hits', mainRs.includes('core.core_controller()') && mainRs.includes('let recent_rules = controller.routing_recent_rule_hits_snapshot_or_empty(running);') && !mainRs.includes('CoreController::new(controller_port, secret.clone())\n        .routing_recent_rule_hits_snapshot_or_empty(running)'), 'typed routing controller');
check('frontend loads routing through deferred page cache', appJs.includes('routing:') && appJs.includes("page === 'routing'") && appJs.includes("invoke('routing_snapshot'"), 'deferred routing load');
check('routing UI uses safe rendering helpers', appJs.includes('function renderRoutingSnapshot') && appJs.includes('replaceChildrenSafe') && appJs.includes('textContent: item.rule'), 'safe routing render');
check('routing never exposes raw subscription or Mihomo rule mutation', !mainRs.includes('save_routing_rule') && !mainRs.includes('update_routing_rule') && !mainRs.includes('delete_routing_rule') && !appJs.includes('customRule') && !appJs.includes('saveRoutingRule'), 'no raw rule mutation');
check('frontend does not call mihomo controller directly', !appJs.includes('/rules') && !appJs.includes('/providers/rules') && !appJs.includes('/configs'), 'backend-only controller access');
check('release and architecture audits know the controlled routing boundary', releaseAudit.includes('controlled routing boundary audit script exists') && architectureAudit.includes('routing-readonly'), 'global gates');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
