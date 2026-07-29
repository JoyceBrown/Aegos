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

function productionDirectWritesOf(text, rel = 'src-tauri/src/main.rs') {
  const directWrites = [
    ...locations(text, /\bfs::write\s*\(/g, rel),
    ...locations(text, /\bfs::copy\s*\(/g, rel),
  ];
  const testModule = /^[ \t]*#\[cfg\(test\)\][ \t]*\r?\n[ \t]*mod[ \t]+tests[ \t]*\{/m.exec(text);
  const testModuleStart = testModule?.index ?? -1;
  return directWrites.filter((item) => testModuleStart < 0 || item.index < testModuleStart);
}

function runSelfTest() {
  const testOnlyLf = 'fn product_path() {}\n#[cfg(test)]\nmod tests {\n  fn fixture() { fs::write("fixture", "value"); }\n}\n';
  const testOnlyCrlf = testOnlyLf.replaceAll('\n', '\r\n');
  const badWrite = 'fn product_path() { fs::write("product", "value"); }\n#[cfg(test)]\nmod tests {}\n';
  const badCopy = 'fn product_path() { fs::copy("source", "product"); }\n#[cfg(test)]\nmod tests {}\n';
  const noTestModule = 'fn product_path() { fs::write("product", "value"); }\n';
  const tests = [
    { name: 'LF test fixtures are excluded', ok: productionDirectWritesOf(testOnlyLf).length === 0 },
    { name: 'CRLF test fixtures are excluded', ok: productionDirectWritesOf(testOnlyCrlf).length === 0 },
    { name: 'production fs::write remains rejected', ok: productionDirectWritesOf(badWrite).length === 1 },
    { name: 'production fs::copy remains rejected', ok: productionDirectWritesOf(badCopy).length === 1 },
    { name: 'missing test boundary fails closed', ok: productionDirectWritesOf(noTestModule).length === 1 },
  ];
  const result = { ok: tests.every((test) => test.ok), tests, generatedAt: new Date().toISOString() };
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}

if (process.argv.includes('--self-test')) runSelfTest();

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
const nativeBrowserDialogs = [
  ...locations(appJs, /\b(?:window\.)?prompt\s*\(/g, 'src/app.js'),
  ...locations(appJs, /\b(?:window\.)?confirm\s*\(/g, 'src/app.js'),
  ...locations(appJs, /\b(?:window\.)?alert\s*\(/g, 'src/app.js'),
];
const forbiddenFrontendInvokes = locations(
  appJs,
  /invoke\(['"`](start_core|stop_core|restart_core|set_system_proxy|update_setting|set_mode|change_proxy|recover_network)['"`]/g,
  'src/app.js',
);

const deadCode = locations(mainRs, /#\[allow\(dead_code\)\]/g, 'src-tauri/src/main.rs');
const legacyProfilePaths = locations(mainRs, /\b(patch_profile_file_legacy|download_profile_source\(|add_profile_url\(&mut self|update_profile\(&mut self|write_runtime_profile_copy)\b/g, 'src-tauri/src/main.rs');
const productionDirectWrites = productionDirectWritesOf(mainRs);
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
    name: 'native browser dialogs are replaced by app dialogs',
    ok: nativeBrowserDialogs.length === 0,
    count: nativeBrowserDialogs.length,
    items: nativeBrowserDialogs,
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
    ok: productionDirectWrites.length === 0,
    count: productionDirectWrites.length,
    items: productionDirectWrites,
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
