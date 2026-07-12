import fs from 'fs';
import path from 'path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const mainRs = read('src-tauri/src/main.rs');
const appJs = read('src/app.js');
const indexHtml = read('src/index.html');
const releaseAudit = read('tools/release-audit.js');

const failures = [];
const passed = [];

function check(name, ok, detail = '') {
  if (ok) passed.push(name);
  else failures.push(`${name}${detail ? ` (${detail})` : ''}`);
}

check('version is at least 3.4.17 diagnostics productization checkpoint', /^3\.4\.(1[7-9]|20)$/.test(pkg.version), pkg.version);
check(
  'diagnostic report export is exposed through backend command',
  mainRs.includes('fn export_diagnostics_report(') &&
    mainRs.includes('export_diagnostics_report,') &&
    mainRs.includes('fn export_diagnostics_report_from_state(') &&
    mainRs.includes('aegos-diagnostics-') &&
    mainRs.includes('diagnostics_report_text(&report)'),
  'export_diagnostics_report'
);
check(
  'diagnostic report export uses background job and local button feedback',
  mainRs.includes('"exportDiagnostics"') &&
    mainRs.includes('export_diagnostics_report_from_state(core.clone(), &app_data)') &&
    appJs.includes("runBackgroundJob('exportDiagnostics'") &&
    appJs.includes('exportDiagBtn') &&
    indexHtml.includes('id="exportDiagBtn"'),
  'exportDiagnostics job'
);
check(
  'diagnostic report text includes summary, checks, next actions, and redaction note',
  mainRs.includes('fn diagnostics_report_text') &&
    mainRs.includes('Next actions:') &&
    mainRs.includes('Checks:') &&
    mainRs.includes('Redaction: sensitive URLs') &&
    mainRs.includes('sanitize_sensitive_text(detail)') &&
    mainRs.includes('sanitize_sensitive_text(hint)'),
  'diagnostic text content'
);
check(
  'log export has redaction notice and category summary',
  mainRs.includes('Aegos Logs Export') &&
    mainRs.includes('Redaction: subscription URLs') &&
    mainRs.includes('Categories:') &&
    mainRs.includes('sanitize_sensitive_text(&entry.line)') &&
    mainRs.includes('"redacted": true') &&
    appJs.includes('日志已脱敏导出'),
  'log export redaction summary'
);
check(
  'diagnostics navigation remains detached and copy/export controls coexist',
  appJs.includes("$('#runDiagBtn').onclick = (event) => runDetachedButtonAction") &&
    appJs.includes("$('#copyDiagBtn'") &&
    appJs.includes('function exportDiagnosticReport') &&
    !appJs.includes("page === 'diagnostics' && shouldRefreshPageCache(page)) runDiagnostics"),
  'navigation safe diagnostics'
);
check(
  'release audit includes diagnostics product gate',
  releaseAudit.includes("audit:diagnostics-product") &&
    releaseAudit.includes('diagnostics productization gate'),
  'release gate'
);

const result = { ok: failures.length === 0, failed: failures, passed };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
