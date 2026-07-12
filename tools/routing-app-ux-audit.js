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
const appJs = read('src/app.js');
const stylesCss = read('src/styles.css');
const releaseAudit = read('tools/release-audit.js');
const interactionSmoke = read('tools/interaction-smoke.js');

const appPreviewStart = appJs.indexOf('function previewAppRoutingDraft');
const appPreviewEnd = appJs.indexOf('function isAegosSystemRoutingRule', appPreviewStart + 1);
const appPreviewBody = appPreviewStart >= 0 ? appJs.slice(appPreviewStart, appPreviewEnd > appPreviewStart ? appPreviewEnd : undefined) : '';

check('package version keeps 3.x app routing UX gate active', /^3\.\d+\.\d+$/.test(pkg.version), pkg.version);
check('routing app UX audit is exposed as package script', pkg.scripts?.['audit:routing-app-ux'] === 'node tools/routing-app-ux-audit.js', 'npm run audit:routing-app-ux');
check('app routing draft UI exists beside website draft UI', appJs.includes('routingAppInput') && appJs.includes('routingAppAction') && appJs.includes('routingAppDraftPreview') && stylesCss.includes('.routing-draft-card'), 'app draft card');
check('app routing preview supports process name and path drafts', appJs.includes('function normalizeAppRuleInput') && appJs.includes('PROCESS-NAME') && appJs.includes('PROCESS-PATH') && appPreviewBody.includes('parsed.kind'), 'process draft kinds');
check('app routing input validates unsafe names before draft', appJs.includes('/[\\r\\n<>|?*]/') && appJs.includes('.exe') && appJs.includes('Telegram.exe'), 'safe app validation');
check('app routing preview is draft-only', !appPreviewBody.includes('invoke(') && !appPreviewBody.includes('start_job') && !appPreviewBody.includes('hot_reload') && !appJs.includes('save_routing_rule'), 'no backend writes');
check('shared draft action keeps user language simple', appJs.includes('function routingDraftAction') && appJs.includes('Proxies') && appJs.includes('DIRECT') && appJs.includes('REJECT'), 'proxy/direct/reject');
check('interaction smoke covers app routing draft', interactionSmoke.includes('routingAppInput') && interactionSmoke.includes('PROCESS-NAME,Telegram.exe'), 'smoke coverage');
check('release audit knows routing app UX audit exists', releaseAudit.includes('routing app UX audit script exists') && releaseAudit.includes('tools/routing-app-ux-audit.js'), 'release-audit');
check('release note exists', exists('RELEASE_3.3.2.md'), 'RELEASE_3.3.2.md');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
