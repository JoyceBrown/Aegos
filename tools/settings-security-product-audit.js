import fs from 'fs';
import path from 'path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const mainRs = read('src-tauri/src/main.rs');
const appJs = read('src/app.js');
const indexHtml = read('src/index.html');
const stylesCss = read('src/styles.css');
const releaseAudit = read('tools/release-audit.js');
const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));

const failures = [];
const passed = [];

function check(name, ok, detail = '') {
  if (ok) passed.push(name);
  else failures.push(`${name}${detail ? ` (${detail})` : ''}`);
}

check('version is 3.4.18 settings/security checkpoint', pkg.version === '3.4.18', pkg.version);
check(
  'environment readiness backend command is registered',
  mainRs.includes('fn environment_readiness(') &&
    mainRs.includes('environment_readiness,') &&
    mainRs.includes('port_owner_detail(settings.mixed_port)') &&
    mainRs.includes('port_owner_detail(settings.controller_port)'),
  'environment_readiness'
);
check(
  'readiness covers install, permission, ports, controller bind, LAN, core, and proxy restore',
  ['webview2', 'admin', 'mixed-port', 'controller-port', 'controller-bind', 'allow-lan', 'core-resource', 'proxy-restore']
    .every((id) => mainRs.includes(`"id": "${id}"`)) &&
    mainRs.includes('默认仅 127.0.0.1 本机访问') &&
    mainRs.includes('allow-lan 开启时会扩大监听面'),
  'readiness checklist'
);
check(
  'settings page exposes user-facing install and security check',
  indexHtml.includes('id="environmentSummary"') &&
    indexHtml.includes('id="environmentRows"') &&
    indexHtml.includes('id="refreshEnvironmentBtn"') &&
    indexHtml.includes('安装与安全检查'),
  'settings UI'
);
check(
  'frontend refreshes readiness without blocking navigation',
  appJs.includes("invoke('environment_readiness'") &&
    appJs.includes('function renderEnvironmentReadiness') &&
    appJs.includes('function refreshEnvironmentReadiness') &&
    appJs.includes("runDetachedButtonAction(event.currentTarget, '检查中...'") &&
    appJs.includes("if (page === 'settings')") &&
    appJs.includes('refreshEnvironmentReadiness(false)'),
  'frontend readiness flow'
);
check(
  'readiness rows have bounded layout for long process/path text',
  stylesCss.includes('.environment-list') &&
    stylesCss.includes('max-height: 186px') &&
    stylesCss.includes('text-overflow: ellipsis') &&
    stylesCss.includes('.environment-row.level-error'),
  'bounded readiness CSS'
);
check(
  'WebView2 installer remains user-visible',
  tauri.bundle?.windows?.webviewInstallMode?.type === 'downloadBootstrapper' &&
    tauri.bundle?.windows?.webviewInstallMode?.silent === false,
  JSON.stringify(tauri.bundle?.windows?.webviewInstallMode)
);
check(
  'release audit includes settings/security product gate',
  releaseAudit.includes("audit:settings-security-product") &&
    releaseAudit.includes('settings security productization gate'),
  'release gate'
);

const result = { ok: failures.length === 0, failed: failures, passed };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
