import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = 'research/flclash-benchmark-2.9.54.md';
const report = fs.existsSync(path.join(root, reportPath))
  ? fs.readFileSync(path.join(root, reportPath), 'utf8')
  : '';
const speedAudit = fs.readFileSync(path.join(root, 'tools/speed-closure-audit.js'), 'utf8');
const interactionSmoke = fs.readFileSync(path.join(root, 'tools/interaction-smoke.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const pass = [];
const fail = [];

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

check('FlClash benchmark report exists', Boolean(report), reportPath);
check(
  'benchmark requires same environment',
  ['Same Windows machine', 'Same physical network', 'Same subscription', 'Same TUN state', 'Same system proxy state'].every((text) => report.includes(text)),
  'same-machine/same-network/same-subscription/same-TUN/same-proxy'
);
check(
  'benchmark covers speed and UI metrics',
  ['Batch speed success count', 'First result latency', 'Full completion time', 'UI responsiveness during test', 'Result sync', 'Failure reason quality', 'No auto switch'].every((text) => report.includes(text)),
  'metrics table'
);
check(
  'benchmark covers critical test matrix',
  ['SS/Trojan/VLESS/TUIC/AnyTLS mixed', 'Rapid navigation during batch speed', 'Subscription switch during batch speed', 'Single-node failed test'].every((text) => report.includes(text)),
  'test matrix'
);
check(
  'benchmark preserves no-copy boundary',
  report.includes('must not copy code, icons, style, or assets') && report.includes('GPL'),
  'GPL boundary'
);
check(
  'Aegos automated evidence backs benchmark',
  ['audit:speed', 'smoke:interactions', 'smoke:perf', 'smoke:soak'].every((text) => report.includes(text)) &&
    speedAudit.includes('batch speed-test backend does not switch proxies') &&
    interactionSmoke.includes('speed test blocked sidebar page switching'),
  'audit/smoke evidence'
);
check('package version is 2.9.54 for this checkpoint', pkg.version === '2.9.54', pkg.version);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
