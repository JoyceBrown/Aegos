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
  (ok ? pass : fail).push({ name, ok, detail });
}

const pkg = readJson('package.json');
const indexHtml = read('src/index.html');
const appJs = read('src/app.js');
const mainRs = read('src-tauri/src/main.rs');
const releaseAudit = read('tools/release-audit.js');
const perfSmoke = read('tools/perf-smoke.js');
const interactionSmoke = read('tools/interaction-smoke.js');

const requiredAudits = [
  'routing-readonly',
  'routing-navigation',
  'routing-mode',
  'routing-groups',
  'routing-types',
  'routing-selection',
  'routing-redaction',
];

check('package version keeps 3.x routing acceptance gate active', /^3\.\d+\.\d+$/.test(pkg.version), pkg.version);
check('all routing audit scripts are exposed', requiredAudits.every((name) => pkg.scripts?.[`audit:${name}`] === `node tools/${name}-audit.js` && exists(`tools/${name}-audit.js`)), requiredAudits.join(', '));
check('release gate knows all routing audits', requiredAudits.every((name) => releaseAudit.includes(`${name}-audit.js`)) && releaseAudit.includes('routing acceptance audit script exists'), 'release-audit routing gates');
check('routing surface is present and read-only', indexHtml.includes('data-page="routing"') && indexHtml.includes('routingReadonlyBadge') && mainRs.includes('fn routing_snapshot') && !mainRs.includes('save_routing_rule'), 'read-only routing surface');
check('routing rendering uses safe text paths', appJs.includes('function renderRoutingSnapshot') && appJs.includes('replaceChildrenSafe') && !/renderRoutingSnapshot[\s\S]*innerHTML/.test(appJs), 'safe routing render');
check('routing page is included in performance and interaction smoke', perfSmoke.includes("'routing'") && interactionSmoke.includes('routing page panel did not activate immediately') && interactionSmoke.includes('routing mode summary did not match current backend mode'), 'runtime smoke coverage');
check(
  'routing cannot reintroduce speed-test switching',
  (appJs.includes('自动选择，测速不会手动切换') ||
    appJs.includes('\\u81ea\\u52a8\\u9009\\u62e9\\uff0c\\u6d4b\\u901f\\u4e0d\\u4f1a\\u624b\\u52a8\\u5207\\u6362')) &&
    !appJs.includes("runBackgroundJob('selectBestProxy'"),
  'speed no-switch semantics'
);

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
