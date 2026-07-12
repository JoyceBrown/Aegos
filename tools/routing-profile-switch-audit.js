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
const mainRs = read('src-tauri/src/main.rs');
const releaseAudit = read('tools/release-audit.js');

const setActiveStart = mainRs.indexOf('fn set_active_profile');
const setActiveEnd = mainRs.indexOf('fn rename_profile', setActiveStart);
const setActiveBody = setActiveStart >= 0 ? mainRs.slice(setActiveStart, setActiveEnd > setActiveStart ? setActiveEnd : undefined) : '';

check('package version is 3.2.4 for profile-switch rule validation checkpoint', pkg.version === '3.2.4', pkg.version);
check('profile switch routing audit is exposed as package script', pkg.scripts?.['audit:routing-profile-switch'] === 'node tools/routing-profile-switch-audit.js', 'npm run audit:routing-profile-switch');
check('profile rule validation summary reuses parsed rule checks', mainRs.includes('fn routing_rule_validation_summary_for_profile') && mainRs.includes('"missingRuleTargets"') && mainRs.includes('"ruleOrderIssues"') && mainRs.includes('"warningCount"'), 'validation summary');
check('profile switch runs rule validation before activation', setActiveBody.includes('routing_rule_validation_summary_for_profile(&profile)') && setActiveBody.includes('Profile switch rule validation warning') && setActiveBody.includes('Profile switch rule validation passed') && setActiveBody.indexOf('routing_rule_validation_summary_for_profile(&profile)') < setActiveBody.indexOf('self.settings.active_profile_id = id.to_string()'), 'set_active_profile validation order');
check('read-only profile validation command is registered', mainRs.includes('fn profile_rule_validation') && mainRs.includes('profile_rule_validation,') && mainRs.includes('Profile not found'), 'profile_rule_validation command');
check('unit coverage counts switch warnings', mainRs.includes('profile_rule_validation_summary_counts_switch_warnings') && mainRs.includes('MissingGroup') && mainRs.includes('later.example'), 'unit coverage');
check('routing remains read-only with no mutation command', !mainRs.includes('save_routing_rule') && !mainRs.includes('update_routing_rule'), 'no rule mutation');
check('release audit knows profile switch routing audit exists', releaseAudit.includes('routing profile switch audit script exists') && releaseAudit.includes('tools/routing-profile-switch-audit.js'), 'release-audit');
check('audit file exists', exists('tools/routing-profile-switch-audit.js'), 'tools/routing-profile-switch-audit.js');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
