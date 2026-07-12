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

const commandStart = mainRs.indexOf('fn routing_reload_preflight(');
const commandEnd = mainRs.indexOf('#[tauri::command]', commandStart + 1);
const commandBody = commandStart >= 0 ? mainRs.slice(commandStart, commandEnd > commandStart ? commandEnd : undefined) : '';

check('package version keeps 3.x routing foundation active', /^3\.\d+\.\d+$/.test(pkg.version), pkg.version);
check('routing reload preflight audit is exposed as package script', pkg.scripts?.['audit:routing-reload-preflight'] === 'node tools/routing-reload-preflight-audit.js', 'npm run audit:routing-reload-preflight');
check('reload preflight contract is structured and rollback-aware', mainRs.includes('fn routing_reload_contract_from_parts') && mainRs.includes('"writesConfig": false') && mainRs.includes('"requiresRollbackPlan": true') && mainRs.includes('"rollback"') && mainRs.includes('"steps"'), 'contract fields');
check('reload preflight command is read-only and registered', mainRs.includes('fn routing_reload_preflight') && mainRs.includes('routing_reload_preflight,') && commandBody.includes('preflight_profile_file(&profile)') && !commandBody.includes('atomic_write') && !commandBody.includes('hot_reload_profile'), 'read-only command');
check('reload preflight reuses profile rule validation', commandBody.includes('routing_rule_validation_summary_for_profile(&profile)') && mainRs.includes('"ruleValidation"'), 'rule validation reuse');
check('unit coverage asserts read-only rollback contract', mainRs.includes('routing_reload_preflight_contract_is_readonly_and_rollback_aware') && mainRs.includes('"writesConfig"') && mainRs.includes('"requiresRollbackPlan"'), 'unit coverage');
check('routing remains read-only with no mutation command', !mainRs.includes('save_routing_rule') && !mainRs.includes('update_routing_rule'), 'no rule mutation');
check('release audit knows reload preflight audit exists', releaseAudit.includes('routing reload preflight audit script exists') && releaseAudit.includes('tools/routing-reload-preflight-audit.js'), 'release-audit');
check('audit file exists', exists('tools/routing-reload-preflight-audit.js'), 'tools/routing-reload-preflight-audit.js');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
