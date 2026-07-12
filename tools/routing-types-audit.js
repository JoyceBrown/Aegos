import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = [];
const pass = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

const pkg = readJson('package.json');
const appJs = read('src/app.js');
const mainRs = read('src-tauri/src/main.rs');
const releaseAudit = read('tools/release-audit.js');

const labelStart = appJs.indexOf('function strategyTypeLabel');
const labelEnd = appJs.indexOf('function renderRoutingSnapshot', labelStart);
const labelBody = labelStart >= 0 ? appJs.slice(labelStart, labelEnd > labelStart ? labelEnd : undefined) : '';
const canonicalStart = mainRs.indexOf('fn canonical_strategy_type');
const canonicalEnd = mainRs.indexOf('#[tauri::command]', canonicalStart);
const canonicalBody = canonicalStart >= 0 ? mainRs.slice(canonicalStart, canonicalEnd > canonicalStart ? canonicalEnd : undefined) : '';
const routingStart = mainRs.indexOf('fn routing_snapshot');
const routingEnd = mainRs.indexOf('#[tauri::command]', routingStart + 1);
const routingBody = routingStart >= 0 ? mainRs.slice(routingStart, routingEnd > routingStart ? routingEnd : undefined) : '';

check('package version keeps 3.x routing type gate active', /^3\.\d+\.\d+$/.test(pkg.version), pkg.version);
check('frontend normalizes strategy type variants before labeling', labelBody.includes("replace(/[\\s_-]/g, '')") && labelBody.includes("value === 'urltest'") && labelBody.includes("value === 'loadbalance'"), 'strategyTypeLabel normalization');
check('frontend labels select/url-test/fallback/load-balance clearly', ['手动选择', '自动测速', '故障切换', '负载均衡'].every((text) => labelBody.includes(text)), 'strategy labels');
check('backend canonicalizes strategy type variants', canonicalBody.includes('"urltest" => "url-test"') && canonicalBody.includes('"loadbalance" => "load-balance"') && canonicalBody.includes('"fallback" => "fallback"') && canonicalBody.includes('"select" => "select"'), 'canonical_strategy_type');
check('backend automatic classification uses canonical types', routingBody.includes('let group_type = canonical_strategy_type(group_type_raw)') && routingBody.includes('matches!(group_type.as_str(), "url-test" | "fallback" | "load-balance")'), 'automatic canonical matching');
check('routing types audit is wired into release gate', releaseAudit.includes('routing types audit script exists'), 'release-audit');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
