import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

function matches(text, pattern) {
  return [...text.matchAll(pattern)];
}

function lineOf(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function locations(text, pattern, rel) {
  return matches(text, pattern).map((match) => ({
    file: rel,
    index: match.index ?? 0,
    line: lineOf(text, match.index ?? 0),
    match: match[0],
  }));
}

const pkg = readJson('package.json');
const appJs = read('src/app.js');
const mainRs = read('src-tauri/src/main.rs');
const releaseAudit = read('tools/release-audit.js');
const architectureAudit = read('tools/architecture-freeze-audit.js');

const dynamicInnerHtml = locations(appJs, /\binnerHTML\s*=/g, 'src/app.js');
const dangerousRenderApis = [
  ...locations(appJs, /\bouterHTML\s*=/g, 'src/app.js'),
  ...locations(appJs, /\binsertAdjacentHTML\s*\(/g, 'src/app.js'),
  ...locations(appJs, /\bdocument\.write\s*\(/g, 'src/app.js'),
  ...locations(appJs, /\beval\s*\(/g, 'src/app.js'),
  ...locations(appJs, /\bnew Function\s*\(/g, 'src/app.js'),
];
const duplicateRendererPatches = [
  ...locations(appJs, /\brenderProfiles\s*=\s*function\b/g, 'src/app.js'),
  ...locations(appJs, /\/\*\s*function renderNodeRow[\s\S]*?\*\//g, 'src/app.js'),
];
const directBusyWrites = locations(appJs, /button\.dataset\.busy\s*=\s*['"`]true['"`]/g, 'src/app.js');
const forbiddenFrontendInvokes = locations(
  appJs,
  /invoke\(['"`](start_core|stop_core|restart_core|set_system_proxy|update_setting|set_mode|change_proxy|recover_network)['"`]/g,
  'src/app.js',
);

const deadCode = locations(mainRs, /#\[allow\(dead_code\)\]/g, 'src-tauri/src/main.rs');
const legacyProfilePaths = locations(mainRs, /\b(patch_profile_file_legacy|download_profile_source\(|add_profile_url\(&mut self|update_profile\(&mut self|write_runtime_profile_copy)\b/g, 'src-tauri/src/main.rs');
const directWrites = [
  ...locations(mainRs, /\bfs::write\s*\(/g, 'src-tauri/src/main.rs'),
  ...locations(mainRs, /\bfs::copy\s*\(/g, 'src-tauri/src/main.rs'),
];
const rawDeletes = locations(mainRs, /\bfs::remove_file\s*\(/g, 'src-tauri/src/main.rs');
const allowedDeleteLines = new Set();
for (const name of ['atomic_write_text_confined', 'remove_file_confined']) {
  const start = mainRs.indexOf(`fn ${name}`);
  const end = start >= 0 ? mainRs.indexOf('\nfn ', start + 1) : -1;
  if (start >= 0) {
    rawDeletes
      .filter((item) => (end < 0 ? item.index >= start : item.index >= start && item.index < end))
      .forEach((item) => allowedDeleteLines.add(item.line));
  }
}
const directDeletes = rawDeletes.filter((item) => !allowedDeleteLines.has(item.line));
const legacyTauriCommands = locations(
  mainRs,
  /#\[tauri::command\]\s*fn\s+(start_core|stop_core|restart_core|set_system_proxy|update_setting|set_mode|change_proxy)\b/g,
  'src-tauri/src/main.rs',
);

const checks = [
  {
    name: 'frontend dynamic innerHTML is fully removed',
    ok: dynamicInnerHtml.length === 0,
    count: dynamicInnerHtml.length,
    items: dynamicInnerHtml,
  },
  {
    name: 'dangerous frontend render APIs stay banned',
    ok: dangerousRenderApis.length === 0,
    count: dangerousRenderApis.length,
    items: dangerousRenderApis,
  },
  {
    name: 'duplicate renderer patches are removed',
    ok: duplicateRendererPatches.length === 0,
    count: duplicateRendererPatches.length,
    items: duplicateRendererPatches,
  },
  {
    name: 'button busy state is centralized',
    ok: directBusyWrites.length === 0,
    count: directBusyWrites.length,
    items: directBusyWrites,
  },
  {
    name: 'frontend does not call legacy core mutation commands directly',
    ok: forbiddenFrontendInvokes.length === 0,
    count: forbiddenFrontendInvokes.length,
    items: forbiddenFrontendInvokes,
  },
  {
    name: 'backend dead_code allowances are removed',
    ok: deadCode.length === 0,
    count: deadCode.length,
    items: deadCode,
  },
  {
    name: 'legacy profile/config paths are removed',
    ok: legacyProfilePaths.length === 0,
    count: legacyProfilePaths.length,
    items: legacyProfilePaths,
  },
  {
    name: 'critical writes use atomic path-confined helpers',
    ok: directWrites.length === 0,
    count: directWrites.length,
    items: directWrites,
  },
  {
    name: 'file deletion is wrapped and path-confined',
    ok: directDeletes.length === 0,
    count: directDeletes.length,
    items: directDeletes,
  },
  {
    name: 'legacy direct Tauri mutation commands are removed or job-only',
    ok: legacyTauriCommands.length === 0,
    count: legacyTauriCommands.length,
    items: legacyTauriCommands,
  },
  {
    name: 'release gate knows the debt audit',
    ok: releaseAudit.includes('debt audit script exists') && architectureAudit.includes('debt-audit'),
    count: releaseAudit.includes('debt audit script exists') && architectureAudit.includes('debt-audit') ? 0 : 1,
    items: [],
  },
];

const failed = checks.filter((check) => !check.ok);
const result = {
  ok: failed.length === 0,
  packageVersion: pkg.version,
  summary: Object.fromEntries(checks.map((check) => [check.name, check.count])),
  failed: failed.map((check) => ({
    name: check.name,
    count: check.count,
    items: check.items.slice(0, 20),
  })),
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
