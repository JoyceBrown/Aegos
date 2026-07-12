import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checklistPath = 'installer-regression-checklist.md';
const checklist = fs.existsSync(path.join(root, checklistPath)) ? fs.readFileSync(path.join(root, checklistPath), 'utf8') : '';
const installerAudit = fs.readFileSync(path.join(root, 'tools', 'installer-candidate-audit.js'), 'utf8');
const releaseAudit = fs.readFileSync(path.join(root, 'tools', 'release-audit.js'), 'utf8');
const tauri = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const pass = [];
const fail = [];

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

check('installer regression checklist exists', Boolean(checklist), checklistPath);
check(
  'checklist covers install prerequisites',
  ['Aegos_{version}_x64-setup.exe', 'WebView2 bootstrapper', '7891', '127.0.0.1', 'allow-lan'].every((text) => checklist.includes(text)),
  'installer prerequisites'
);
check(
  'checklist covers network restoration',
  ['Disconnect restores previous system proxy', 'App exit restores previous system proxy', 'Disconnect protection close cleans firewall rules', 'Repair/recovery action'].every((text) => checklist.includes(text)),
  'proxy/firewall recovery'
);
check(
  'checklist covers speed and subscription regressions',
  ['Switch subscription during speed test', 'One-click speed test does not switch node', 'Failed speed result shows reason'].every((text) => checklist.includes(text)),
  'subscription/speed'
);
check(
  'checklist covers UI responsiveness',
  ['Rapid navigation does not freeze', 'Diagnostics can run while switching pages', 'Speed test can run while switching pages', 'Different window heights do not cause layout jumps'].every((text) => checklist.includes(text)),
  'UI responsiveness'
);
check(
  'checklist includes current automated gates',
  ['audit:speed-target', 'audit:flclash', 'audit:provider-healthcheck', 'audit:installer', 'audit:release', 'smoke:interactions'].every((text) => checklist.includes(text)),
  'automated gates'
);
check(
  'installer candidate audit remains available',
  installerAudit.includes('Aegos installer exists or release is source-only') || installerAudit.includes('installer'),
  'tools/installer-candidate-audit.js'
);
check(
  'Tauri installer WebView2 bootstrapper remains configured',
  tauri.bundle?.windows?.webviewInstallMode?.type === 'downloadBootstrapper' && tauri.bundle?.windows?.webviewInstallMode?.silent === false,
  JSON.stringify(tauri.bundle?.windows?.webviewInstallMode)
);
check(
  'release audit knows installer regression gate',
  releaseAudit.includes('installer regression audit script exists'),
  'tools/release-audit.js'
);
check('package version is 2.9.57 for this checkpoint', pkg.version === '2.9.57', pkg.version);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
