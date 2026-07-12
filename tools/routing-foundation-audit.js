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

const requiredScripts = [
  'audit:routing-rules',
  'audit:routing-targets',
  'audit:routing-order',
  'audit:routing-profile-switch',
  'audit:routing-reload-preflight',
  'audit:routing-rollback',
  'audit:routing-diagnostics',
  'audit:routing-foundation',
];

const commandStart = mainRs.indexOf('#[tauri::command]\nfn routing_foundation_acceptance');
const commandEnd = mainRs.indexOf('#[tauri::command]\nfn start_proxy_delay_test', commandStart + 1);
const commandBody = commandStart >= 0 ? mainRs.slice(commandStart, commandEnd > commandStart ? commandEnd : undefined) : '';

check('package version keeps 3.x routing foundation active', /^3\.\d+\.\d+$/.test(pkg.version), pkg.version);
check('routing foundation audit is exposed as package script', pkg.scripts?.['audit:routing-foundation'] === 'node tools/routing-foundation-audit.js', 'npm run audit:routing-foundation');
check('all routing foundation scripts are present', requiredScripts.every((script) => Boolean(pkg.scripts?.[script])), requiredScripts.join(', '));
check('routing foundation acceptance command is registered', mainRs.includes('fn routing_foundation_acceptance') && mainRs.includes('routing_foundation_acceptance,'), 'routing_foundation_acceptance command');
check('foundation command is read-only', commandBody.includes('routing_foundation_acceptance_contract') && !commandBody.includes('atomic_write_text_confined') && !commandBody.includes('hot_reload_profile') && !commandBody.includes('set_active_profile'), 'read-only acceptance command');
check('foundation contract keeps editing disabled', mainRs.includes('fn routing_foundation_acceptance_contract') && mainRs.includes('"editableRoutingEnabled": false') && mainRs.includes('"writesConfig": false') && mainRs.includes('"readOnly": true'), 'editing disabled');
check('foundation contract lists required audits and next gate', requiredScripts.every((script) => mainRs.includes(script)) && mainRs.includes('"nextGate"') && mainRs.includes('3.3 editable routing design'), 'required audits and next gate');
check('foundation covers parser, target, order, switch, preflight, rollback, diagnostics', ['structured records', 'rule targets', 'rule order', 'profile switch', 'reload preflight', 'rollback plan', 'diagnostics report'].every((text) => mainRs.includes(text)), 'acceptance coverage');
check('unit coverage asserts editing stays disabled', mainRs.includes('routing_foundation_acceptance_keeps_editing_disabled_until_gates_pass') && mainRs.includes('"editableRoutingEnabled"') && mainRs.includes('"requiresAllAuditsPassing"'), 'unit coverage');
check('routing remains mutation-disabled at acceptance checkpoint', !mainRs.includes('save_routing_rule') && !mainRs.includes('update_routing_rule') && !mainRs.includes('delete_routing_rule'), 'no rule mutation command');
check('release audit knows foundation audit exists', releaseAudit.includes('routing foundation audit script exists') && releaseAudit.includes('tools/routing-foundation-audit.js'), 'release-audit');
check('release note exists', exists('RELEASE_3.2.8.md'), 'RELEASE_3.2.8.md');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
