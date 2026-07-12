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

const commandStart = mainRs.indexOf('fn routing_diagnostics_report(');
const commandEnd = mainRs.indexOf('#[tauri::command]', commandStart + 1);
const commandBody = commandStart >= 0 ? mainRs.slice(commandStart, commandEnd > commandStart ? commandEnd : undefined) : '';

check('package version keeps 3.x routing foundation active', /^3\.\d+\.\d+$/.test(pkg.version), pkg.version);
check('routing diagnostics audit is exposed as package script', pkg.scripts?.['audit:routing-diagnostics'] === 'node tools/routing-diagnostics-audit.js', 'npm run audit:routing-diagnostics');
check('routing diagnostics command is registered', mainRs.includes('fn routing_diagnostics_report') && mainRs.includes('routing_diagnostics_report,'), 'routing_diagnostics_report command');
check('diagnostics command composes existing read-only contracts', commandBody.includes('routing_rule_validation_summary_for_profile(&profile)') && commandBody.includes('routing_reload_contract_from_parts') && commandBody.includes('routing_rollback_plan_from_parts'), 'composed diagnostics');
check('diagnostics command remains read-only', !commandBody.includes('atomic_write_text_confined') && !commandBody.includes('hot_reload_profile') && !commandBody.includes('set_active_profile'), 'no writes/reload/switch');
check('diagnostics report has severity, summary, and sections', mainRs.includes('fn routing_diagnostics_report_from_parts') && mainRs.includes('"severity"') && mainRs.includes('"summary"') && mainRs.includes('"sections"'), 'report shape');
check('diagnostics report exposes rule/runtime/rollback sections', mainRs.includes('"runtime-preflight"') && mainRs.includes('"rollback"') && mainRs.includes('"next-actions"') && mainRs.includes('"Rule validation"'), 'sections');
check('unit coverage escalates findings', mainRs.includes('routing_diagnostics_report_escalates_rule_and_runtime_findings') && mainRs.includes('runtime preflight failed') && mainRs.includes('Some("error")'), 'unit coverage');
check('routing remains mutation-disabled in diagnostics checkpoint', !mainRs.includes('save_routing_rule') && !mainRs.includes('update_routing_rule') && !mainRs.includes('delete_routing_rule'), 'no rule mutation command');
check('release audit knows diagnostics audit exists', releaseAudit.includes('routing diagnostics audit script exists') && releaseAudit.includes('tools/routing-diagnostics-audit.js'), 'release-audit');
check('release note exists', exists('RELEASE_3.2.7.md'), 'RELEASE_3.2.7.md');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
