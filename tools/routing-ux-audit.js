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

const previewStart = appJs.indexOf('function previewWebsiteRoutingDraft');
const previewEnd = appJs.indexOf('function isAegosSystemRoutingRule', previewStart + 1);
const previewBody = previewStart >= 0 ? appJs.slice(previewStart, previewEnd > previewStart ? previewEnd : undefined) : '';

check('package version keeps 3.x routing UX gate active', /^3\.\d+\.\d+$/.test(pkg.version), pkg.version);
check('routing UX audit is exposed as package script', pkg.scripts?.['audit:routing-ux'] === 'node tools/routing-ux-audit.js', 'npm run audit:routing-ux');
check('routing static text is normalized at runtime for readable Chinese', appJs.includes('function normalizeRoutingStaticText') && appJs.includes('\\u5b89\\u5168\\u9884\\u89c8') && appJs.includes('routingSystemRuleCount'), 'runtime text normalization');
check('website routing preview exists and is draft-only', appJs.includes('function ensureRoutingAssistantUi') && appJs.includes('routingWebsiteInput') && appJs.includes('routingDraftPreview') && previewBody.includes('DOMAIN-SUFFIX') && !previewBody.includes('invoke('), 'draft-only website wizard');
check('website preview validates user input before draft', appJs.includes('function normalizeWebsiteRuleInput') && appJs.includes('example.com') && appJs.includes('routingWebsiteAction'), 'domain validation');
check('Aegos internal landing IP rules are hidden from normal rule rows', appJs.includes('function isAegosSystemRoutingRule') && appJs.includes('Aegos Landing IP') && appJs.includes('systemRules') && appJs.includes('rawRules.filter((item) => !isAegosSystemRoutingRule(item))'), 'system rule filtering');
check('routing rows use dedicated UX classes instead of generic simple rows', appJs.includes('routing-row routing-group-row') && appJs.includes('routing-row routing-rule-row') && stylesCss.includes('.routing-group-row') && stylesCss.includes('.routing-rule-row'), 'dedicated routing rows');
check('routing page has stable grid rows and isolated table scroll areas', stylesCss.includes('grid-template-rows: auto auto auto minmax') && stylesCss.includes('.routing-table-card') && stylesCss.includes('.routing-card .simple-list'), 'stable routing layout');
check('routing preview does not add backend locks or config writes', !appJs.includes('save_routing_rule') && !appJs.includes('update_routing_rule') && !previewBody.includes('start_job') && !previewBody.includes('hot_reload'), 'no write path');
check('release audit knows routing UX audit exists', releaseAudit.includes('routing UX audit script exists') && releaseAudit.includes('tools/routing-ux-audit.js'), 'release-audit');
check('release note exists', exists('RELEASE_3.3.1.md'), 'RELEASE_3.3.1.md');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
