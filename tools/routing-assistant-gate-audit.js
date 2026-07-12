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

const commandStart = mainRs.indexOf('#[tauri::command]\nfn routing_assistant_gate');
const commandEnd = mainRs.indexOf('#[tauri::command]\nfn start_proxy_delay_test', commandStart + 1);
const commandBody = commandStart >= 0 ? mainRs.slice(commandStart, commandEnd > commandStart ? commandEnd : undefined) : '';

check('package version keeps 3.x routing assistant gate active', /^3\.\d+\.\d+$/.test(pkg.version), pkg.version);
check('routing assistant gate audit is exposed as package script', pkg.scripts?.['audit:routing-assistant-gate'] === 'node tools/routing-assistant-gate-audit.js', 'npm run audit:routing-assistant-gate');
check('routing assistant gate command is registered', mainRs.includes('fn routing_assistant_gate') && mainRs.includes('routing_assistant_gate,'), 'routing_assistant_gate command');
check('assistant gate command is read-only', commandBody.includes('routing_assistant_gate_contract') && !commandBody.includes('atomic_write_text_confined') && !commandBody.includes('hot_reload_profile') && !commandBody.includes('set_active_profile'), 'read-only gate command');
check('assistant gate depends on 3.2 foundation', mainRs.includes('"dependsOn": "3.2 routing foundation acceptance"') && mainRs.includes('"startsAt": "3.3.1"'), '3.2 dependency / 3.3.1 start');
check('assistant gate keeps writes disabled', mainRs.includes('fn routing_assistant_gate_contract') && mainRs.includes('"writesConfig": false') && mainRs.includes('"writeEnabled": false') && mainRs.includes('"writeEnableGate"'), 'writes disabled');
check('assistant gate covers 3.3.1 through 3.3.9', ['3.3.1', '3.3.2', '3.3.3', '3.3.4', '3.3.5', '3.3.6', '3.3.7', '3.3.8', '3.3.9'].every((version) => mainRs.includes(version)), '3.3.x wizard steps');
check('unit coverage asserts gate stays read-only', mainRs.includes('routing_assistant_gate_defers_writes_until_wizard_steps_are_built') && mainRs.includes('Some("3.3.1")'), 'unit coverage');
check('routing remains mutation-disabled at assistant gate', !mainRs.includes('save_routing_rule') && !mainRs.includes('update_routing_rule') && !mainRs.includes('delete_routing_rule'), 'no rule mutation command');
check('release audit knows assistant gate audit exists', releaseAudit.includes('routing assistant gate audit script exists') && releaseAudit.includes('tools/routing-assistant-gate-audit.js'), 'release-audit');
check('release note exists', exists('RELEASE_3.3.0.md'), 'RELEASE_3.3.0.md');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
