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
