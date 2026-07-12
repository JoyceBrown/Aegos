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

const handlerStart = appJs.indexOf('const routingDraftButton = event.target.closest');
const handlerEnd = appJs.indexOf('const closeButton = event.target.closest', handlerStart + 1);
const handlerBody = handlerStart >= 0 ? appJs.slice(handlerStart, handlerEnd > handlerStart ? handlerEnd : undefined) : '';

check('package version is 3.3.3 connection draft checkpoint', pkg.version === '3.3.3', pkg.version);
check('routing connection draft audit is exposed as package script', pkg.scripts?.['audit:routing-connection-draft'] === 'node tools/routing-connection-draft-audit.js', 'npm run audit:routing-connection-draft');
check('connection rows expose a draft action without replacing close action', appJs.includes('dataset: { routingDraftTarget: target }') && appJs.includes('dataset: { closeConnection: item.id }') && stylesCss.includes('.connection-actions'), 'connection action row');
check('connection target normalization supports domain and IPv4 drafts', appJs.includes('function normalizeConnectionRoutingTarget') && appJs.includes('IP-CIDR') && appJs.includes('DOMAIN-SUFFIX') && appJs.includes('/32'), 'domain/ip draft targets');
check('connection draft handler only updates frontend routing preview', handlerBody.includes("setPage('routing')") && handlerBody.includes('previewConnectionRoutingDraftFromButton') && !handlerBody.includes('invoke(') && !handlerBody.includes('start_job'), 'frontend-only handler');
check('connection draft preview remains write-disabled', !appJs.includes('save_routing_rule') && !appJs.includes('update_routing_rule') && !appJs.includes('delete_routing_rule'), 'no routing mutation commands');
check('interaction smoke covers connection draft flow', interactionSmoke.includes('data-routing-draft-target') && interactionSmoke.includes('DOMAIN-SUFFIX,example.com'), 'smoke coverage');
check('release audit knows routing connection draft audit exists', releaseAudit.includes('routing connection draft audit script exists') && releaseAudit.includes('tools/routing-connection-draft-audit.js'), 'release-audit');
check('release note exists', exists('RELEASE_3.3.3.md'), 'RELEASE_3.3.3.md');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
