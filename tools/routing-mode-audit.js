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
const interactionSmoke = read('tools/interaction-smoke.js');
const releaseAudit = read('tools/release-audit.js');

const routingStart = mainRs.indexOf('fn routing_snapshot');
const routingEnd = mainRs.indexOf('#[tauri::command]', routingStart + 1);
const routingBody = routingStart >= 0
  ? mainRs.slice(routingStart, routingEnd > routingStart ? routingEnd : undefined)
  : '';

check('package version remains within the 3.1 routing mode lane', /^3\.1\.\d+$/.test(pkg.version), pkg.version);
check('routing page exposes a current mode summary field', indexHtml.includes('<span>当前模式</span><b id="routingModeState">-</b>'), 'routingModeState');
check('backend routing snapshot reads mode from core settings', routingBody.includes('core.settings.mode.clone()') && routingBody.includes('"mode": mode'), 'routing_snapshot mode');
check('frontend renders routing mode through shared modeLabel', appJs.includes("$('#routingModeState').textContent = modeLabel(data.mode || latestStatus?.mode || 'rule')"), 'modeLabel render');
check('mode changes invalidate routing cache and update visible summary optimistically', appJs.includes("invalidatePageCache('routing')") && appJs.includes("const routingMode = $('#routingModeState')") && appJs.includes('routingMode.textContent = label'), 'applyOptimisticMode');
check('routing mode is covered by interaction smoke', interactionSmoke.includes('routing mode summary did not match current backend mode'), 'interaction smoke');
check('routing mode audit is wired into release gate', releaseAudit.includes('routing mode audit script exists'), 'release-audit');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
