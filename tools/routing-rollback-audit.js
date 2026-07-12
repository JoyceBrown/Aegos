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

const commandStart = mainRs.indexOf('fn routing_rollback_plan(');
const commandEnd = mainRs.indexOf('#[tauri::command]', commandStart + 1);
const commandBody = commandStart >= 0 ? mainRs.slice(commandStart, commandEnd > commandStart ? commandEnd : undefined) : '';

check('package version keeps 3.x routing foundation active', /^3\.\d+\.\d+$/.test(pkg.version), pkg.version);
check('routing rollback audit is exposed as package script', pkg.scripts?.['audit:routing-rollback'] === 'node tools/routing-rollback-audit.js', 'npm run audit:routing-rollback');
check('rollback plan command is registered', mainRs.includes('fn routing_rollback_plan') && mainRs.includes('routing_rollback_plan,'), 'routing_rollback_plan command');
check('rollback plan command is read-only', commandBody.includes('sha256_file(&profile_path)') && commandBody.includes('runtime_profile_path()') && !commandBody.includes('atomic_write_text_confined') && !commandBody.includes('hot_reload_profile') && !commandBody.includes('set_active_profile'), 'read-only digest snapshot');
check('rollback contract requires atomic restore and path policy', mainRs.includes('fn routing_rollback_plan_from_parts') && mainRs.includes('"requiresAtomicRestore": true') && mainRs.includes('"pathPolicy"') && mainRs.includes('"atomic_write_text_confined"'), 'rollback contract fields');
check('rollback contract preserves runtime and selection state', mainRs.includes('"runtimeProfileId"') && mainRs.includes('"runtimeConfigDigest"') && mainRs.includes('"selectedProxyMapSize"') && mainRs.includes('"trafficTakeover"'), 'runtime/selection state');
check('rollback restore sequence is explicit', mainRs.includes('"restoreSequence"') && mainRs.includes('restore previous profile file') && mainRs.includes('verify controller version'), 'restore sequence');
check('unit coverage asserts read-only rollback plan', mainRs.includes('routing_rollback_plan_tracks_restore_contract_without_writes') && mainRs.includes('"rollbackReady"') && mainRs.includes('"writesConfig"'), 'unit coverage');
check('routing remains mutation-disabled in rollback checkpoint', !mainRs.includes('save_routing_rule') && !mainRs.includes('update_routing_rule') && !mainRs.includes('delete_routing_rule'), 'no rule mutation command');
check('release audit knows rollback audit exists', releaseAudit.includes('routing rollback audit script exists') && releaseAudit.includes('tools/routing-rollback-audit.js'), 'release-audit');
check('release note exists', exists('RELEASE_3.2.6.md'), 'RELEASE_3.2.6.md');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
