import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

const pkg = readJson('package.json');
const packageJson = read('package.json');
const mainRs = read('src-tauri/src/main.rs');
const coreRuntimeRs = read('src-tauri/src/core_runtime.rs');
const appJs = read('src/app.js');
const stylesCss = read('src/styles.css');
const releaseAudit = read('tools/release-audit.js');
const report = exists('PRODUCT_MATURITY_GAP_REPORT.md') ? read('PRODUCT_MATURITY_GAP_REPORT.md') : '';

function semverAtLeast(version, baseline) {
  const parse = (value) => String(value).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const current = parse(version);
  const min = parse(baseline);
  for (let index = 0; index < Math.max(current.length, min.length); index += 1) {
    const left = current[index] || 0;
    const right = min[index] || 0;
    if (left !== right) return left > right;
  }
  return true;
}

check('connection closure audit is exposed as package script', packageJson.includes('"audit:connection-closure": "node tools/connection-closure-audit.js"'), 'package.json');
check('package version keeps connection closure lane after 3.4.12', semverAtLeast(pkg.version, '3.4.12'), pkg.version);
check('release audit knows connection closure audit', releaseAudit.includes('connection closure audit script exists'), 'tools/release-audit.js');
check('backend exposes user-facing connection phase and next action', coreRuntimeRs.includes('pub fn connection_phase(') && coreRuntimeRs.includes('pub fn connection_status_json(') && coreRuntimeRs.includes('"phase"') && coreRuntimeRs.includes('"label"') && coreRuntimeRs.includes('"nextAction"') && mainRs.includes('core_runtime::connection_status_json(') && !mainRs.includes('fn connection_phase(&self)'), 'connection_phase/summary');
check('app status includes lightweight connection summary', mainRs.includes('"connection": self.connection_status_summary()'), 'status connection summary');
check('connection closure still returns current node and outbound IP for jobs', mainRs.includes('fn connection_closure(&self)') && mainRs.includes('core_runtime::connection_closure_json(') && coreRuntimeRs.includes('"currentNode"') && coreRuntimeRs.includes('"outboundIp"') && coreRuntimeRs.includes('"outboundIpKnown"'), 'job connection closure');
check('manual system proxy preference still does not auto-connect', mainRs.includes('System proxy preference enabled; connect before applying Windows proxy takeover') && mainRs.includes('if enable && !self.traffic_takeover'), 'manual proxy preference path');
check('frontend reads backend connection applied/wanted state', appJs.includes('const connection = status.connection || {}') && appJs.includes('connection.systemProxyApplied') && appJs.includes('connection.systemProxyWanted'), 'renderStatus connection source');
check('system proxy status row is never hidden from ordinary users', appJs.includes("$('#proxyStateRow').classList.remove('hidden')") && !appJs.includes("$('#proxyStateRow').classList.toggle('hidden', !settings.systemProxy)"), 'proxy state row visible');
check('system proxy incomplete state is visually flagged', appJs.includes("$('#proxyState').classList.toggle('is-danger', !systemProxyApplied)") && stylesCss.includes('.status-card dd.is-danger') && appJs.includes("$('#systemProxyMetric').classList.toggle('is-danger', !systemProxyApplied)"), 'danger state');
check('outbound IP lookup uses sequence guard to reject stale results', appJs.includes('outboundIpRequestSeq') && appJs.includes('outboundIpPendingSeq') && appJs.includes('if (seq !== outboundIpRequestSeq) return') && appJs.includes('setOutboundIpText(outboundIpLastStable'), 'outbound IP stale guard');
check('gap report requires connection closure before 3.5.x', report.includes('连接') && report.includes('落地 IP 过期') && report.includes('3.4.12'), 'gap report alignment');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
