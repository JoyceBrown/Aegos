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

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

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

function suspiciousLines(rel) {
  const text = read(rel);
  const pattern = /(�|鈫|鈱|鈼|鈻|鉁|鈬|脳|鏈|鍗|棣欐腐|绛夊緟|鏃|鏂|鍚|鍙|鐐|鑺|璁|缃|钀|杩|淇|妯|绾|绯|鐘舵|闃|浠ｇ悊|涓诲|灞€|楠|绋|寮|姝|鎺|闂)/;
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ file: rel, line: index + 1, text: line.trim() }))
    .filter((item) => pattern.test(item.text));
}

const pkg = readJson('package.json');
const indexHtml = read('src/index.html');
const appJs = read('src/app.js');
const releaseAudit = read('tools/release-audit.js');
const doc = exists('copy-encoding-debt.md') ? read('copy-encoding-debt.md') : '';
const productionSuspicious = [
  ...suspiciousLines('src/index.html'),
  ...suspiciousLines('src/app.js'),
];
const documentedCount = Number(doc.match(/Current production suspicious line count:\s*(\d+)/)?.[1] ?? NaN);
const dangerousProductionApis = /\b(innerHTML\s*=|outerHTML\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(|eval\s*\(|new Function\s*\()/m;

check('package version keeps copy encoding gate after 2.9.58', semverAtLeast(pkg.version, '2.9.58'), pkg.version);
check('copy and encoding debt ledger exists', exists('copy-encoding-debt.md'), 'copy-encoding-debt.md');
check('debt ledger records the current suspicious production baseline', documentedCount === productionSuspicious.length, `${documentedCount}/${productionSuspicious.length}`);
check('HTML declares UTF-8 and Chinese locale', /<meta charset="UTF-8">/.test(indexHtml) && /<html lang="zh-CN">/.test(indexHtml), 'UTF-8 zh-CN');
check('production frontend keeps dynamic HTML injection banned', !dangerousProductionApis.test(appJs), 'src/app.js');
check('production frontend has safe text rendering helpers', appJs.includes('function text(value') && appJs.includes('function el(tag') && appJs.includes('function replaceChildrenSafe'), 'text/el/replaceChildrenSafe');
check('copy debt cleanup route is documented', ['small batches', 'plain user-facing Chinese', 'manual visual check', 'Suspicious line count'].every((needle) => doc.includes(needle)), 'cleanup route');
check('release audit knows copy encoding gate', releaseAudit.includes('copy encoding audit script exists'), 'tools/release-audit.js');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  suspiciousProductionLines: productionSuspicious.length,
  sample: productionSuspicious.slice(0, 12),
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
