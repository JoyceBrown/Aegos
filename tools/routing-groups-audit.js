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
const speedAudit = read('tools/speed-closure-audit.js');
const releaseAudit = read('tools/release-audit.js');

const routingStart = mainRs.indexOf('fn routing_snapshot');
const routingEnd = mainRs.indexOf('#[tauri::command]', routingStart + 1);
const routingBody = routingStart >= 0
  ? mainRs.slice(routingStart, routingEnd > routingStart ? routingEnd : undefined)
  : '';
const renderStart = appJs.indexOf('function renderRoutingSnapshot');
const renderEnd = appJs.indexOf('async function refreshRoutingSnapshot', renderStart);
const renderBody = renderStart >= 0
  ? appJs.slice(renderStart, renderEnd > renderStart ? renderEnd : undefined)
  : '';

check('package version keeps 3.x routing group gate active', /^3\.\d+\.\d+$/.test(pkg.version), pkg.version);
check('routing page labels strategy groups as separate from nodes', indexHtml.includes('aria-label="策略组列表，不是普通节点列表"') && indexHtml.includes('<span>说明</span>'), 'routing group table copy');
check('routing snapshot groups come from proxy groups, not ordinary node rows', routingBody.includes('core.proxy_groups()') && routingBody.includes('"itemCount"') && routingBody.includes('"automatic"'), 'proxy_groups snapshot');
check('routing page excludes internal proxy groups from strategy group count and rows', mainRs.includes('fn is_internal_proxy_group_name') && routingBody.includes('!is_internal_proxy_group_name(name)') && routingBody.includes('group_rows.len()'), 'GLOBAL and Aegos Landing IP are internal');
check('routing group renderer only renders group rows in routing table', renderBody.includes('const groups = Array.isArray(data.groups)') && renderBody.includes("replaceChildrenSafe($('#routingGroupRows')") && !renderBody.includes("replaceChildrenSafe($('#nodeRows')"), 'routingGroupRows only');
check('ordinary node lists still exclude proxy-group references', appJs.includes('function isProxyGroupReferenceItem') && appJs.includes('function isRealProxyNodeItem') && appJs.includes('!isRealProxyNodeItem(item)'), 'node list proxy-group/builtin policy filter');
check('speed tests still exclude proxy-group references', mainRs.includes('fn is_proxy_group_reference_item') && mainRs.includes('speed_targets_skip_proxy_group_references') && speedAudit.includes('speed-test targets exclude proxy-group references'), 'speed target proxy-group filter');
check('routing groups audit is wired into release gate', releaseAudit.includes('routing groups audit script exists'), 'release-audit');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
