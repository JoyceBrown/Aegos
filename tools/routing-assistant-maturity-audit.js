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
  (ok ? pass : fail).push({ name, ok: Boolean(ok), detail });
}

const pkg = readJson('package.json');
const appJs = read('src/app.js');
const stylesCss = read('src/styles.css');
const mainRs = read('src-tauri/src/main.rs');
const releaseAudit = read('tools/release-audit.js');

check('package version is in 3.3/3.4 execution lane', /^3\.(?:3|4)\.\d+$/.test(pkg.version), pkg.version);
check('routing assistant maturity audit is exposed', pkg.scripts?.['audit:routing-assistant-maturity'] === 'node tools/routing-assistant-maturity-audit.js', 'package.json');
check('3.3.4 region and strategy target wizard exists', appJs.includes('routingRegionSelect') && appJs.includes('routingTargetSelect') && appJs.includes('regionRoutingDraftPreset') && appJs.includes('GEOSITE') && appJs.includes('GEOIP'), 'region/strategy wizard');
check('3.3.5 rule conflict prompts exist before apply', appJs.includes('function classifyRoutingDraft') && appJs.includes('missingTarget') && appJs.includes('duplicateDraft') && appJs.includes('routingConflictSummary'), 'conflict classifier');
check('3.3.6 one-click undo exists', appJs.includes('function undoLastRoutingDraft') && appJs.includes('undoRoutingDraftBtn') && appJs.includes('removeRoutingDraft'), 'undo controls');
check('3.3.7 rule effectiveness verification is non-disruptive', appJs.includes('function verifyRoutingDraft') && appJs.includes('verifiedAt') && !appJs.includes('verifyRoutingDraft(' + 'id)' + '.then'), 'local verification');
check('3.3.8 draft details replace confusing simple/advanced toggle', appJs.includes('expandedRoutingDraftId') && appJs.includes('toggleRoutingDraftDetail') && !appJs.includes('routingSimpleViewBtn') && !appJs.includes('routingAdvancedViewBtn') && stylesCss.includes('.routing-draft-detail'), 'per-draft details');
check('3.3.9 assistant acceptance remains draft-first', appJs.includes('routingAssistantDrafts') && appJs.includes('renderRoutingDraftList') && mainRs.includes('"3.3.9"') && mainRs.includes('"writesConfig": false'), 'draft-first acceptance');
check('assistant target list is fed from read-only routing snapshot', appJs.includes('latestRoutingSnapshot') && appJs.includes('refreshRoutingTargetOptions') && appJs.includes('renderRoutingSnapshot(data || {})'), 'snapshot target options');
check('assistant does not add routing mutation commands', !appJs.includes('saveRoutingRule') && !appJs.includes('save_routing_rule') && !mainRs.includes('save_routing_rule') && !mainRs.includes('update_routing_rule') && !mainRs.includes('delete_routing_rule'), 'no mutation commands');
check('assistant layout has stable draft rows', stylesCss.includes('.routing-draft-row') && stylesCss.includes('.routing-draft-main') && stylesCss.includes('grid-template-columns: minmax(220px, 1fr) 76px 64px 64px 64px') && stylesCss.includes('overflow: auto'), 'stable layout');
check('website and app proxy drafts can choose target group or node', appJs.includes('routingWebsiteTargetSelect') && appJs.includes('routingAppTargetSelect') && appJs.includes('routingProxyTargetOptions') && appJs.includes('syncRoutingProxyTargetFields'), 'target selector');
check('release audit knows assistant maturity audit exists', releaseAudit.includes('routing assistant maturity audit script exists'), 'release-audit');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
