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
check('transparent window disabled for performance', tauri.app?.windows?.[0]?.transparent === false, `transparent=${tauri.app?.windows?.[0]?.transparent}`);
check('WebView2 online bootstrapper is skipped', tauri.bundle?.windows?.webviewInstallMode?.type === 'skip', JSON.stringify(tauri.bundle?.windows?.webviewInstallMode));
check('mihomo bundled as only core resource', exists('resources/core/mihomo.exe') && !exists('resources/core/sing-box.exe'), 'resources/core');
check('Aegos installer exists', exists(installer), installer);
check('Aegis installer name is not reused', !exists(`src-tauri/target/release/bundle/nsis/Aegis-Setup-${pkg.version}.exe`), 'no Aegis installer artifact');
check('UI smoke script exists', exists('tools/ui-smoke.js'), 'tools/ui-smoke.js');

const mainRs = readText('src-tauri/src/main.rs');
const powershellCalls = (mainRs.match(/Command::new\("powershell\.exe"\)/g) || []).length;
check('PowerShell commands are hidden on Windows', powershellCalls === 1 && /fn run_powershell[\s\S]*creation_flags\(CREATE_NO_WINDOW\)/.test(mainRs), `${powershellCalls} powershell launcher(s)`);

const indexHtml = readText('src/index.html');
const appJs = readText('src/app.js');
const uiText = `${indexHtml}\n${appJs}`;
check('UI text has no mojibake fragments', !/(�|鈫|鈱|鈼|鈻|鉁|鈬|脳|鏈|鍗|棣欐腐|绛夊緟)/.test(uiText), 'index/app text encoding');
check('navigation pages are present', ['home', 'nodes', 'connections', 'profiles', 'diagnostics', 'logs', 'settings'].every((page) => indexHtml.includes(`data-page="${page}"`) && indexHtml.includes(`data-page-panel="${page}"`)), 'all primary pages');
check('TUN switch exists in settings UI', indexHtml.includes('id="tunToggle"') && appJs.includes("['tunToggle', 'tunEnabled']"), 'tunToggle');
check('TUN switch exists on home UI', indexHtml.includes('id="tunHomeToggle"') && appJs.includes("['tunHomeToggle', 'tunEnabled']"), 'tunHomeToggle');
check('sidebar duplicate profile card is removed', !/<section class="profile">/.test(indexHtml), 'no sidebar profile block');
check('home nodes use table rows', appJs.includes('class="row home-row') && !appJs.includes('class="home-node'), 'home-row renderer');
check('home endpoint line is removed', !indexHtml.includes('id="nodeHost"'), 'no nodeHost line');
check('home drag regions are declared', (indexHtml.match(/data-tauri-drag-region/g) || []).length >= 2, 'titlebar and brand drag regions');
check('quick actions have eight direct-operation buttons', (indexHtml.match(/id="quick[A-Za-z]+Btn"/g) || []).length >= 8 && indexHtml.includes('id="quickUpdateSubBtn"') && indexHtml.includes('id="quickProxyBtn"') && indexHtml.includes('id="quickTunBtn"'), '8 quick actions');
check('region filters live with home node table', indexHtml.includes('class="region-row"') && indexHtml.indexOf('class="region-row"') > indexHtml.indexOf('class="home-nodes'), 'region-row in home nodes');
check('protocol UI does not display core name', indexHtml.includes('id="protocolState"') && indexHtml.includes('id="protocolMetric"') && !indexHtml.includes('>mihomo<'), 'protocolState/protocolMetric');
check('Rust window controls are wired', ['window_minimize', 'window_toggle_maximize', 'window_close', 'window_start_dragging'].every((name) => mainRs.includes(name) && appJs.includes(name)), 'window commands');
check('subscription URI parser is available', mainRs.includes('parse_uri_subscription') && mainRs.includes('base64'), 'URI/base64 subscriptions');
check('TUIC URI subscriptions are supported', mainRs.includes('parse_tuic_uri') && mainRs.includes('line.starts_with("tuic://")'), 'tuic:// parser');
check('traffic stream uses snapshot reader', mainRs.includes('fn traffic_snapshot') && !mainRs.includes('controller("GET", "/traffic"'), '/traffic snapshot');

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
