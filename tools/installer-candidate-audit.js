import crypto from 'node:crypto';
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

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function sha256(rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
}

const pkg = readJson('package.json');
const tauri = readJson('src-tauri/tauri.conf.json');
const cargoToml = read('src-tauri/Cargo.toml');
const cargoVersion = cargoToml.match(/^version = "([^"]+)"/m)?.[1] || '';
const releaseDoc = `RELEASE_${pkg.version}.md`;
const releaseNotes = exists(releaseDoc) ? read(releaseDoc) : '';
const installer = `src-tauri/target/release/bundle/nsis/Aegos_${pkg.version}_x64-setup.exe`;
const installerExists = exists(installer);
const installerHash = installerExists ? sha256(installer) : '';
const installerSize = installerExists ? fs.statSync(path.join(root, installer)).size : 0;
const mainRs = read('src-tauri/src/main.rs');
const releaseAudit = read('tools/release-audit.js');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
}

check('installer audit is exposed as package script', pkg.scripts?.['audit:installer'] === 'node tools/installer-candidate-audit.js', 'npm run audit:installer');
check('package/Tauri/Cargo versions match', pkg.version === tauri.version && pkg.version === cargoVersion, `${pkg.version}/${tauri.version}/${cargoVersion}`);
check('release note exists for installer candidate', exists(releaseDoc), releaseDoc);
check('release note is not marked source-only', !releaseNotes.includes('Source-only') && !releaseNotes.includes('source-only'), releaseDoc);
check('NSIS installer exists for package version', installerExists, installer);
check('installer size is plausible', installerSize > 10 * 1024 * 1024 && installerSize < 80 * 1024 * 1024, `${installerSize} bytes`);
check('installer hash is recorded in release note', Boolean(installerHash) && releaseNotes.toLowerCase().includes(installerHash.toLowerCase()), installerHash || 'missing');
check('installer path uses Aegos product name', installer.includes(`Aegos_${pkg.version}_x64-setup.exe`) && !installer.includes('Aegis'), installer);
check('Tauri bundle targets NSIS', Array.isArray(tauri.bundle?.targets) && tauri.bundle.targets.includes('nsis'), JSON.stringify(tauri.bundle?.targets));
check('WebView2 bootstrapper remains user-visible', tauri.bundle?.windows?.webviewInstallMode?.type === 'downloadBootstrapper' && tauri.bundle?.windows?.webviewInstallMode?.silent === false, JSON.stringify(tauri.bundle?.windows?.webviewInstallMode));
check('mihomo core is bundled and no alternate core is accidentally added', exists('resources/core/mihomo.exe') && !exists('resources/core/sing-box.exe'), 'resources/core');
check('installer defaults avoid port 7890 conflict', mainRs.includes('const AEGOS_DEFAULT_MIXED_PORT: u16 = 7891') && mainRs.includes('const AEGOS_DEFAULT_CONTROLLER_PORT: u16 = 19091'), 'mixed=7891 controller=19091');
check('window remains resizable and non-transparent', tauri.app?.windows?.[0]?.resizable === true && tauri.app?.windows?.[0]?.transparent === false, `resizable=${tauri.app?.windows?.[0]?.resizable} transparent=${tauri.app?.windows?.[0]?.transparent}`);
check('release audit knows installer audit exists', releaseAudit.includes('audit:installer') && releaseAudit.includes('installer candidate audit script exists'), 'release gate includes installer lane');

const failed = results.filter((item) => !item.ok);
console.log(JSON.stringify({
  ok: failed.length === 0,
  failed,
  passed: results.filter((item) => item.ok),
  installer: installerExists ? installer : null,
  sha256: installerHash || null,
  size: installerSize,
  generatedAt: new Date().toISOString()
}, null, 2));

if (failed.length) process.exit(1);
