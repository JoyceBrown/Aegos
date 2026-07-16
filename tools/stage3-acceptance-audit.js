import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const exists = (rel) => fs.existsSync(path.join(root, rel));
const check = (name, ok, detail = '') => (ok ? pass : fail).push({ name, ok: Boolean(ok), detail });
const sha256 = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');

const pkg = JSON.parse(read('package.json'));
const appJs = read('src/app.js');
const mainRs = read('src-tauri/src/main.rs');
const interactionSmoke = read('tools/interaction-smoke.js');
const releaseAudit = read('tools/release-audit.js');
const stage3Version = '3.6.0';
const installer = `src-tauri/target/release/bundle/nsis/Aegos_${stage3Version}_x64-setup.exe`;
const installerHash = exists(installer) ? sha256(installer) : '';
const stage3Release = exists(`RELEASE_${stage3Version}.md`) ? read(`RELEASE_${stage3Version}.md`) : '';
const testStart = appJs.indexOf('function testRoutingWebsiteRule');
const testEnd = appJs.indexOf('function renderRoutingDraftPreview', testStart);
const testBody = testStart >= 0 && testEnd > testStart ? appJs.slice(testStart, testEnd) : '';

check('version is at or beyond the 3.6.0 stage-3 checkpoint', /^3\.6\.(?:[0-9]|[1-3][0-9]|40)$/.test(pkg.version), pkg.version);
check('package exposes the stage 3 acceptance audit', pkg.scripts?.['audit:stage3-acceptance'] === 'node tools/stage3-acceptance-audit.js', 'npm run audit:stage3-acceptance');
check('ordinary user can create, verify, apply, edit, delete, and test routing rules', appJs.includes('previewWebsiteRoutingDraft') && appJs.includes('previewAppRoutingDraft') && appJs.includes('verifyAllRoutingDrafts') && appJs.includes('applyRoutingDrafts') && appJs.includes('submitRoutingRuleForm') && appJs.includes('deleteRoutingRule') && appJs.includes('testRoutingWebsiteRule') && mainRs.includes('fn apply_routing_rule_edit') && mainRs.includes('commit_profile_routing_config'), 'stage 3 rule lifecycle');
check('stage 3 remains safe: preview/test are read-only and apply uses preflight/rollback', appJs.includes('precheckRoutingDraftsBeforeApply') && appJs.includes('routingRuleMatchesWebsite') && !testBody.includes('runBackgroundJob') && !testBody.includes('invoke(') && mainRs.includes('preflight_profile_source') && mainRs.includes('rollback'), 'read-only preview/test and guarded apply');
check('interaction smoke covers the real user path', interactionSmoke.includes('routingRuleTestInput') && interactionSmoke.includes('previewWebsiteRuleBtn') && interactionSmoke.includes('previewAppRuleBtn') && interactionSmoke.includes('connection draft action did not navigate to routing page') && interactionSmoke.includes('node route action did not open the target-site editor') && appJs.includes('verifyAllRoutingDraftsBtn') && appJs.includes('applyRoutingDraftsBtn'), 'interaction smoke user path');
check('all stage 3 audit gates are still wired', ['audit:stage3-rules-page', 'audit:stage3-website-rules', 'audit:stage3-app-rules', 'audit:stage3-strategy-selector', 'audit:stage3-conflict-explanation', 'audit:stage3-rule-preview', 'audit:stage3-preapply-check', 'audit:stage3-postapply-verify', 'audit:stage3-rule-list-management', 'audit:stage3-system-rules', 'audit:stage3-node-rule-link', 'audit:stage3-rule-test', 'audit:stage3-ux-polish'].every((name) => Boolean(pkg.scripts?.[name])), 'stage 3 audit scripts');
check('release audit knows the stage 3 acceptance gate', releaseAudit.includes('stage 3 acceptance audit script exists') && releaseAudit.includes('tools/stage3-acceptance-audit.js') && releaseAudit.includes('audit:stage3-acceptance'), 'tools/release-audit.js');
check('3.6.0 installer checkpoint remains reproducibly recorded after later releases', exists(installer) && installerHash.length === 64 && stage3Release.includes('3.6.0') && stage3Release.includes('npm run audit:stage3-acceptance') && stage3Release.includes(installerHash) && !stage3Release.includes('Source-only'), installer);

const result = { ok: fail.length === 0, failed: fail, passed: pass, installer, installerHash, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
