import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = [];
const pass = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

function suspiciousLines(rel) {
  const text = read(rel);
  const suspicious =
    /[�]|[锟絴閳鑴鏈鍗棣绛鏃鏂鍚鍙鐐鑺璁缃钀杩淇妯绾绯鐘闃浠涓灞楠绋寮姝鎺闂]|[\u0100-\u024F\u0300-\u06FF\u0700-\u0FFF\u1C00-\u1C7F\uE000-\uF8FF]|[\uD800-\uDFFF]/u;
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ rel, line: index + 1, text: line.trim() }))
    .filter((item) => suspicious.test(item.text));
}

const appJs = read('src/app.js');
const indexHtml = read('src/index.html');
const releaseAudit = read('tools/release-audit.js');
const coreRuntimeRs = read('src-tauri/src/core_runtime.rs');
const mainRs = read('src-tauri/src/main.rs');
const doc = exists('STATUS_VOCABULARY_3.5.71.md') ? read('STATUS_VOCABULARY_3.5.71.md') : '';
const frontendSuspicious = [
  ...suspiciousLines('src/app.js'),
  ...suspiciousLines('src/index.html'),
];

check('status vocabulary document exists', exists('STATUS_VOCABULARY_3.5.71.md'), 'STATUS_VOCABULARY_3.5.71.md');
check(
  'vocabulary covers runtime, proxy, permission, and diagnostic states',
  ['核心待命', '已接管', '待生效', '待连接', '管理员', '未检查', '错误'].every((term) => doc.includes(term)),
  'required user-facing terms'
);
check(
  'frontend owns shared status helpers',
  ['const STATUS_TEXT = Object.freeze', 'function enabledLabel', 'function systemProxyUiLabel', 'function runtimeSummaryLabel', 'function statusSurfaceNotice'].every((needle) => appJs.includes(needle)),
  'STATUS_TEXT helpers'
);
check(
  'home and settings consume shared status helpers',
  appJs.includes("$('.ring strong').textContent = trafficTakeover ? STATUS_TEXT.connected") &&
    appJs.includes("$('#settingsRuntimeSummary').textContent = runtimeSummaryLabel") &&
    appJs.includes("$('#systemProxyMetric').textContent = systemProxyUiLabel"),
  'renderStatus/renderSettings'
);
check(
  'software state and network availability are separate user-visible fields',
  indexHtml.includes('id="softwareState"') &&
    indexHtml.includes('id="networkAvailabilityState"') &&
    indexHtml.includes('id="networkAvailabilityMetric"') &&
    appJs.includes("$('#softwareState').textContent = runtimeSummaryLabel") &&
    appJs.includes("$('#networkAvailabilityState').textContent = availability.label") &&
    appJs.includes("$('#networkAvailabilityMetric').textContent = availability.label"),
  'softwareState/networkAvailabilityState'
);
check(
  'home status notice is derived from the shared status snapshot',
  appJs.includes('setNotice(statusSurfaceNotice(status, settings, protection, availability))') &&
    appJs.includes('availability.state ===') &&
    appJs.includes('systemProxyWanted && !systemProxyApplied'),
  'statusSurfaceNotice'
);
check(
  'backend exposes non-blocking network availability in status surface',
  coreRuntimeRs.includes('pub fn network_availability_json(') &&
    coreRuntimeRs.includes('"networkUsable"') &&
    coreRuntimeRs.includes('"softwareReady"') &&
    coreRuntimeRs.includes('"availability": network_availability') &&
    mainRs.includes('fn network_availability(&self) -> JsonValue') &&
    mainRs.includes('self.network_availability()') &&
    mainRs.includes('diagnostics_status_from_snapshot'),
  'network.availability'
);
check('frontend visible text has no abnormal Unicode fragments', frontendSuspicious.length === 0, JSON.stringify(frontendSuspicious.slice(0, 12)));
check('release audit wires status vocabulary gate', releaseAudit.includes('audit:status-vocabulary'), 'tools/release-audit.js');
check('frontend keeps dynamic HTML injection banned', !/\b(innerHTML\s*=|outerHTML\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(|eval\s*\(|new Function\s*\()/m.test(appJs), 'src/app.js');
check('index declares UTF-8 Chinese UI shell', /<meta charset="UTF-8">/.test(indexHtml) && /<html lang="zh-CN">/.test(indexHtml), 'src/index.html');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
