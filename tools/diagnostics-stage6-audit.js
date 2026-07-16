import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const html = read('src/index.html');
const app = read('src/app.js');
const css = read('src/styles.css');
const main = read('src-tauri/src/main.rs');
const core = read('src-tauri/src/core_runtime.rs');
const diagnostics = read('src-tauri/src/diagnostics_runtime.rs');
const tasks = read('src-tauri/src/task_runtime.rs');
const interaction = read('tools/interaction-smoke.js');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  (ok ? passes : failures).push({ name, detail });
}

check(
  '3.6.17 unified public Aegos errors',
  diagnostics.includes('pub struct AegosIssue') &&
    diagnostics.includes('pub fn issue_from_failure') &&
    diagnostics.includes('AEG-CON-002') &&
    diagnostics.includes('AEG-SUB-003') &&
    diagnostics.includes('AEG-NOD-004') &&
    diagnostics.includes('AEG-DNS-001') &&
    diagnostics.includes('AEG-TUN-001') &&
    diagnostics.includes('AEG-PRX-001') &&
    diagnostics.includes('AEG-FW-001') &&
    tasks.includes('pub issue: Option<JsonValue>') &&
    main.includes('set_job_issue(&jobs, &id, json!(issue.clone()))'),
  'errors need stable codes, human copy, structured actions, and job transport'
);

check(
  '3.6.18 seven ordinary-user problem groups',
  ['connection', 'subscription', 'node', 'dns', 'tun', 'system-proxy', 'firewall']
    .every((category) => html.includes(`data-diagnostic-category="${category}"`) && app.includes(`${category}:`) || html.includes(`data-diagnostic-category="${category}"`)) &&
    main.includes('"groups": ["connection", "subscription", "node", "dns", "tun", "system-proxy", "firewall"]') &&
    app.includes('const diagnosticCategoryOrder'),
  'all Stage 6 categories must be filterable and grouped'
);

check(
  '3.6.19 every failed issue explains action',
  diagnostics.includes('pub action: String') &&
    diagnostics.includes('object.insert(') &&
    diagnostics.includes('"hint".to_string()') &&
    app.includes("el('b', { textContent: '建议' })") &&
    app.includes('item.hint'),
  'failure rows show explanation and next action instead of raw engine output'
);

check(
  '3.6.20 repair actions are allowlisted and re-diagnosed',
  main.includes('fn is_supported_diagnostic_repair_action') &&
    main.includes('"system-proxy" => core.repair_system_proxy_takeover()') &&
    main.includes('"recommended-ports" => core.repair_recommended_ports()') &&
    main.includes('"cleanup-firewall"') &&
    main.includes('"restart-core"') &&
    main.includes('"recover-network" => core.recover_network(true)') &&
    main.includes('diagnostic_repair_allowlist_rejects_unknown_system_actions') &&
    app.includes("runBackgroundJob('repairDiagnostic'") &&
    app.includes('await runDiagnostics(false)') &&
    interaction.includes('diagnostic repair did not use the repair background job'),
  'repairs are restricted, run in background, verify outcome, and reject arbitrary actions'
);

check(
  '3.6.21 support report is redacted and atomically written',
  main.includes('fn diagnostics_report_text') &&
    main.includes('Recent evidence (redacted):') &&
    main.includes('sanitize_sensitive_text(line)') &&
    main.includes('atomic_write_text_confined(&path, &export_dir, &content)') &&
    main.includes('support_report_keeps_aegos_codes_and_redacts_evidence') &&
    html.includes('id="exportDiagBtn"') && html.includes('导出支持报告'),
  'support export includes diagnosis and redacted evidence without leaking credentials or local paths'
);

check(
  '3.6.22 node diagnosis distinguishes concrete failures',
  core.includes('"refused"') &&
    diagnostics.includes('"节点响应超时"') &&
    diagnostics.includes('"DNS 解析异常"') &&
    diagnostics.includes('"安全握手失败"') &&
    diagnostics.includes('"节点认证失败"') &&
    diagnostics.includes('"节点拒绝连接"') &&
    diagnostics.includes('"节点协议暂不支持"') &&
    main.includes('"issue": issue') &&
    main.includes('fn node_diagnostics_from_snapshot'),
  'node failures cannot collapse into 未测速 or a generic controller error'
);

check(
  '3.6.23 subscription diagnosis is structured',
  ['AEG-SUB-001', 'AEG-SUB-002', 'AEG-SUB-003', 'AEG-SUB-004', 'AEG-SUB-005', 'AEG-SUB-006']
    .every((code) => diagnostics.includes(code)) &&
    main.includes('"subscription update"') &&
    main.includes('"issue": issue') &&
    main.includes('download_profile_source_url_diagnostic'),
  'URL, download, authorization, format, protocol, and empty subscription failures are distinct'
);

check(
  'diagnostics and logs are one product surface',
  !html.includes('data-page="logs"') &&
    !html.includes('data-page-panel="logs"') &&
    html.includes('data-diagnostic-view="overview"') &&
    html.includes('data-diagnostic-view="logs"') &&
    app.includes("diagnosticView === 'logs'") &&
    css.includes('.diagnostic-view.active') &&
    interaction.includes('running diagnostics blocked the internal logs view'),
  'logs are lazy internal evidence, not a competing top-level workflow'
);

check(
  'technical detail is collapsed and safe-rendered',
  app.includes("el('details', { className: 'diagnostic-technical' }") &&
    app.includes("el('code', { textContent: item.technicalDetail })") &&
    !app.includes('innerHTML =') &&
    css.includes('.diagnostic-technical summary'),
  'ordinary users see human explanations first; evidence remains available without HTML injection'
);

check(
  'diagnostics and repairs do not take the global foreground lock',
  app.includes("runDetachedButtonAction(event.currentTarget, '诊断中...'" ) &&
    app.includes("runDetachedButtonAction(button, '修复中...'" ) &&
    interaction.includes('running diagnostics blocked sidebar page switching'),
  'navigation and other read-only pages remain usable while diagnosis or repair runs'
);

const versionParts = String(pkg.version).split('.').map((part) => Number.parseInt(part, 10) || 0);
const stage6Carried = versionParts[0] > 3 ||
  (versionParts[0] === 3 && (versionParts[1] > 6 || (versionParts[1] === 6 && versionParts[2] >= 24)));
check(
  'Stage 6 remains carried after its 3.6.24 completion point',
  stage6Carried,
  pkg.version
);

const result = { ok: failures.length === 0, failures, passes };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
