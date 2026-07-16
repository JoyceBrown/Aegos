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

const versionParts = pkg.version.split('.').map(Number);
check('version is at least 3.4.18 settings/security checkpoint', versionParts[0] > 3 || (versionParts[0] === 3 && (versionParts[1] > 4 || (versionParts[1] === 4 && versionParts[2] >= 18))), pkg.version);
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
    mainRs.includes('Controller is bound to 127.0.0.1 by default.') &&
    mainRs.includes('allow-lan expands the listening surface.'),
  'readiness checklist'
);
check(
  'settings page exposes a plain-language on-demand system check',
  indexHtml.includes('id="environmentSummary"') &&
    indexHtml.includes('id="environmentRows"') &&
    indexHtml.includes('id="refreshEnvironmentBtn"') &&
    indexHtml.includes('id="environmentDetailsBtn"') &&
    indexHtml.includes('系统检查') &&
    indexHtml.includes('运行检查'),
  'settings UI'
);
check(
  'frontend refreshes readiness without blocking navigation',
  appJs.includes("invoke('environment_readiness'") &&
    appJs.includes('function renderEnvironmentReadiness') &&
    appJs.includes('function refreshEnvironmentReadiness') &&
    appJs.includes('function refreshSettingsChecks') &&
    appJs.includes("runDetachedButtonAction(event.currentTarget, '检查中...'") &&
    appJs.includes("if (isPageActive('settings')) renderEnvironmentReadiness(data)") &&
    !appJs.includes('refreshEnvironmentReadiness(false)'),
  'frontend readiness flow'
);
check(
  'readiness rows avoid nested scrolling and expose details on demand',
  stylesCss.includes('.environment-list') &&
    !stylesCss.includes('max-height: 186px') &&
    stylesCss.includes('.environment-action') &&
    stylesCss.includes('white-space: normal') &&
    stylesCss.includes('text-overflow: ellipsis') &&
    stylesCss.includes('.environment-row.level-error'),
  'single-scroll readiness CSS'
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
