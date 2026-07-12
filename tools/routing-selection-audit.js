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
const indexHtml = read('src/index.html');
const appJs = read('src/app.js');
const mainRs = read('src-tauri/src/main.rs');
const speedAudit = read('tools/speed-closure-audit.js');
const releaseAudit = read('tools/release-audit.js');

const renderStart = appJs.indexOf('function renderRoutingSnapshot');
const renderEnd = appJs.indexOf('async function refreshRoutingSnapshot', renderStart);
const renderBody = renderStart >= 0 ? appJs.slice(renderStart, renderEnd > renderStart ? renderEnd : undefined) : '';

check('package version is 3.1.5 for routing selection checkpoint', pkg.version === '3.1.5', pkg.version);
check('routing table keeps current selection separate from speed results', indexHtml.includes('<span>当前选择</span>') && renderBody.includes('item.now ||'), 'current selection column');
check('automatic strategy groups are explained without implying connection', renderBody.includes('自动策略，测速不切换') && renderBody.includes('手动/只读'), 'automatic/manual copy');
check('routing snapshot exposes automatic behavior as metadata only', mainRs.includes('"automatic": matches!(group_type.as_str(), "url-test" | "fallback" | "load-balance")'), 'automatic metadata');
check('speed tests remain guarded as measurement-only', speedAudit.includes('speed tests remain measurement-only') || speedAudit.includes('batch speed-test backend does not switch proxies'), 'speed measurement-only');
check('routing selection audit is wired into release gate', releaseAudit.includes('routing selection audit script exists'), 'release-audit');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
