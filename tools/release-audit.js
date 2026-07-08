import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = [];
const pass = [];

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

function sha256(rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
}

function readText(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const pkg = readJson('package.json');
const tauri = readJson('src-tauri/tauri.conf.json');
const installer = `src-tauri/target/release/bundle/nsis/Aegos_${pkg.version}_x64-setup.exe`;

check('package name is aegos', pkg.name === 'aegos', pkg.name);
check('product name is Aegos', tauri.productName === 'Aegos', tauri.productName);
check('identifier does not collide with Aegis', tauri.identifier === 'com.codex.aegos', tauri.identifier);
check('Tauri shell configured', Boolean(pkg.devDependencies?.['@tauri-apps/cli']), '@tauri-apps/cli');
check('mihomo bundled as only core resource', exists('resources/core/mihomo.exe') && !exists('resources/core/sing-box.exe'), 'resources/core');
check('Aegos installer exists', exists(installer), installer);
check('Aegis installer name is not reused', !exists(`src-tauri/target/release/bundle/nsis/Aegis-Setup-${pkg.version}.exe`), 'no Aegis installer artifact');
check('UI smoke script exists', exists('tools/ui-smoke.js'), 'tools/ui-smoke.js');

const mainRs = readText('src-tauri/src/main.rs');
const powershellCalls = (mainRs.match(/Command::new\("powershell\.exe"\)/g) || []).length;
check('PowerShell commands are hidden on Windows', powershellCalls === 1 && /fn run_powershell[\s\S]*creation_flags\(CREATE_NO_WINDOW\)/.test(mainRs), `${powershellCalls} powershell launcher(s)`);

const uiText = `${readText('src/index.html')}\n${readText('src/app.js')}`;
check('UI text has no mojibake fragments', !/[锛鈱鈼鈻鉁鈬脳]/.test(uiText), 'index/app text encoding');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  installer: exists(installer) ? {
    path: installer,
    size: fs.statSync(path.join(root, installer)).size,
    sha256: sha256(installer)
  } : null,
  generatedAt: new Date().toISOString()
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
