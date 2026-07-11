import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appJs = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const mainRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
const interactionSmoke = fs.readFileSync(path.join(root, 'tools', 'interaction-smoke.js'), 'utf8');
const releaseAudit = fs.readFileSync(path.join(root, 'tools', 'release-audit.js'), 'utf8');
const backendAudit = fs.readFileSync(path.join(root, 'tools', 'backend-audit.js'), 'utf8');

const fail = [];
const pass = [];

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

function bodyOf(name) {
  const match = appJs.match(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`));
  return match?.[1] || '';
}

function sliceBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return start >= 0 && end > start ? source.slice(start, end) : '';
}

const schedulePageLoadBody = bodyOf('schedulePageLoad');
const runDiagnosticsBody = bodyOf('runDiagnostics');
const exportLogsBody = bodyOf('exportLogs');
const diagnosticsBackendBody = sliceBetween(mainRs, 'fn diagnostics(&mut self) -> JsonValue', 'fn add_profile_url_detached');
const exportLogsBackendBody = sliceBetween(mainRs, 'fn export_logs(&self) -> Result<JsonValue, String>', 'fn recent_log_summary');
const diagnosticsJobBody = sliceBetween(mainRs, '"diagnostics" => {', '"recoverNetwork" => {');

check(
  'diagnostics page navigation renders cached data only',
  schedulePageLoadBody.includes("page === 'diagnostics'") &&
    schedulePageLoadBody.includes('renderCachedDiagnostics();') &&
    schedulePageLoadBody.includes('markPageCache(page);') &&
    !schedulePageLoadBody.includes('runDiagnostics(') &&
    !schedulePageLoadBody.includes("runBackgroundJob('diagnostics'"),
  'navigation must not start heavy diagnostics'
);

check(
  'diagnostics runs as a background job with local button feedback',
  runDiagnosticsBody.includes("runBackgroundJob('diagnostics'") &&
    runDiagnosticsBody.includes('pageCacheState.diagnostics.loading') &&
    runDiagnosticsBody.includes('pollMs: 300') &&
    appJs.includes("$('#runDiagBtn').onclick = (event) => runDetachedButtonAction(event.currentTarget, '诊断中...', () => runDiagnostics())"),
  'diagnostics button may show busy state without blocking global navigation'
);

check(
  'stale diagnostics results cannot force the user back to diagnostics',
  runDiagnosticsBody.includes("isCurrentPageTask(token, 'diagnostics')") &&
    runDiagnosticsBody.includes("markPageCache('diagnostics')") &&
    interactionSmoke.includes('running diagnostics blocked sidebar page switching'),
  'background completion is cache-only when the user has moved away'
);

check(
  'diagnostic report includes summary, details, hints, and copy UI',
  appJs.includes('function renderDiagnosticSummary') &&
    appJs.includes('function renderDiagnosticRows') &&
    appJs.includes('function diagnosticReportText') &&
    appJs.includes('summary.nextActions') &&
    appJs.includes('diagnostic-hint') &&
    indexHtml.includes('id="diagSummary"') &&
    indexHtml.includes('id="diagRows"') &&
    indexHtml.includes('id="copyDiagBtn"') &&
    diagnosticsBackendBody.includes('"summary"') &&
    diagnosticsBackendBody.includes('"nextActions"') &&
    diagnosticsBackendBody.includes('"hint"'),
  'diagnostics must be actionable, not just red/green status'
);

check(
  'logs are categorized and filterable without backend calls',
  appJs.includes('let logFilter =') &&
    appJs.includes('function logCategoryLabel') &&
    appJs.includes('[data-log-filter]') &&
    indexHtml.includes('data-log-filter="user"') &&
    indexHtml.includes('data-log-filter="runtime"') &&
    indexHtml.includes('data-log-filter="core"') &&
    indexHtml.includes('data-log-filter="diagnostic"') &&
    indexHtml.includes('data-log-filter="debug"') &&
    interactionSmoke.includes('log filters triggered backend calls'),
  'log filtering should be instant client-side UI'
);

check(
  'logs can be exported with a user-visible path',
  exportLogsBody.includes("invoke('export_logs'") &&
    exportLogsBody.includes('result?.path') &&
    exportLogsBackendBody.includes('aegos-logs-') &&
    exportLogsBackendBody.includes('items.len()') &&
    exportLogsBackendBody.includes('fs::write(&path, content)') &&
    interactionSmoke.includes('log export button did not call export_logs'),
  'support export for user support and diagnostics'
);

check(
  'backend exposes diagnostics and export logs through normal commands and job runner',
  mainRs.includes('fn diagnostics(state: State<AppState>) -> Result<JsonValue, String>') &&
    mainRs.includes('fn export_logs(state: State<AppState>) -> Result<JsonValue, String>') &&
    diagnosticsJobBody.includes('set_job_state(&jobs, &id, "running"') &&
    diagnosticsJobBody.includes('diagnostics_detached(core.clone())') &&
    mainRs.includes('fn diagnostics_detached(core: Arc<Mutex<CoreManager>>) -> JsonValue') &&
    backendAudit.includes('diagnostics include severity summary and actionable hints') &&
    releaseAudit.includes('diagnostics page shows severity summary and copyable report') &&
    releaseAudit.includes('logs are categorized, filterable, and exportable'),
  'backend and broader audits keep diagnostics/logs wired'
);

check(
  'diagnostics does expensive work outside the CoreManager lock',
  mainRs.includes('struct DiagnosticsSnapshot') &&
    mainRs.includes('fn take_diagnostics_snapshot(core: Arc<Mutex<CoreManager>>) -> DiagnosticsSnapshot') &&
    mainRs.includes('fn diagnostics_from_snapshot(snapshot: DiagnosticsSnapshot) -> JsonValue') &&
    mainRs.includes('patch_config_with_settings(source, &snapshot.settings') &&
    mainRs.includes('read_windows_proxy_snapshot()') &&
    mainRs.includes('port_owner_detail(snapshot.settings.mixed_port)') &&
    diagnosticsJobBody.includes('diagnostics_detached(core.clone())') &&
    !diagnosticsJobBody.includes('core.lock().unwrap().diagnostics()'),
  'diagnostics must not hold the core mutex while reading files, Windows proxy, or ports'
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
