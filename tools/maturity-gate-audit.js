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

const pkg = readJson('package.json');
const roadmap = exists('ROADMAP_3.0.0_TO_3.6.4.md') ? read('ROADMAP_3.0.0_TO_3.6.4.md') : '';
const packageJson = read('package.json');
const releaseAudit = read('tools/release-audit.js');
const securityAudit = read('tools/security-hotfix-audit.js');
const speedAudit = read('tools/speed-closure-audit.js');
const responsivenessAudit = read('tools/responsiveness-audit.js');
const stabilityAudit = read('tools/stability-regression-audit.js');
const interactionSmoke = read('tools/interaction-smoke.js');
const perfSmoke = read('tools/perf-smoke.js');
const mainRs = read('src-tauri/src/main.rs');
const appJs = read('src/app.js');

const requiredScripts = [
  'audit:release',
  'audit:security',
  'audit:speed',
  'audit:responsiveness',
  'audit:stability',
  'audit:installer-regression',
  'audit:copy',
  'audit:opensource',
  'smoke:interactions',
  'smoke:perf',
  'smoke:soak',
];

const requiredRoadmapVersions = [
  '3.0.0',
  '3.1.0',
  '3.1.1',
  '3.1.2',
  '3.1.3',
  '3.1.4',
  '3.1.5',
  '3.1.6',
  '3.1.7',
  '3.2.1',
  '3.2.2',
  '3.2.3',
  '3.2.4',
  '3.2.5',
  '3.2.6',
  '3.2.7',
  '3.2.8',
  '3.3.1',
  '3.3.2',
  '3.3.3',
  '3.3.4',
  '3.3.5',
  '3.3.6',
  '3.3.7',
  '3.3.8',
  '3.3.9',
  '3.4.1',
  '3.4.2',
  '3.4.3',
  '3.4.4',
  '3.4.5',
  '3.4.6',
  '3.4.7',
  '3.4.8',
  '3.4.9',
  '3.4.10',
  '3.5.1',
  '3.5.2',
  '3.5.3',
  '3.5.4',
  '3.5.5',
  '3.5.6',
  '3.5.7',
  '3.5.8',
  '3.5.9',
  '3.6.1',
  '3.6.2',
  '3.6.3',
  '3.6.4',
];

check('package version stays in the 3.0.0 to 3.6.4 maturity roadmap', /^3\.(?:[0-6])\.\d+$/.test(pkg.version), pkg.version);
check('3.0 to 3.6.4 execution roadmap exists', exists('ROADMAP_3.0.0_TO_3.6.4.md'), 'ROADMAP_3.0.0_TO_3.6.4.md');
check('roadmap includes every required small version through 3.6.4', requiredRoadmapVersions.every((version) => roadmap.includes(version)), '3.0.0..3.6.4');
check(
  'roadmap preserves critical stop gates',
  [
    '\u6d4b\u901f\u5207\u6362\u6216\u8fde\u63a5\u4e86\u8282\u70b9',
    '\u963b\u585e\u5bfc\u822a',
    '\u8ba2\u9605 token',
    'IPv6/DNS \u68c0\u6d4b\u6539\u53d8\u4e86\u7528\u6237\u8fde\u63a5',
  ].every((text) => roadmap.includes(text)),
  'stop gates'
);
check('required maturity scripts are exposed', requiredScripts.every((name) => packageJson.includes(`"${name}"`)), requiredScripts.join(', '));
check('release audit knows maturity gate', releaseAudit.includes('maturity gate audit script exists'), 'tools/release-audit.js');
check(
  'speed tests remain measurement-only',
  speedAudit.includes('batch speed-test backend does not switch proxies') &&
    speedAudit.includes('single-node speed test does not switch proxies') &&
    speedAudit.includes("!speedBody.includes('select_best_proxy')") &&
    speedAudit.includes("!singleBody.includes('select_best_proxy')") &&
    mainRs.includes('ensure_core_for_delay_test'),
  'speed measurement-only'
);
check('navigation and heavy jobs stay non-blocking', responsivenessAudit.includes('navigation') && interactionSmoke.includes('running diagnostics blocked sidebar page switching') && perfSmoke.includes('i < 420'), 'navigation/perf gates');
check('security gate covers logs, controller, ACL, and safe DOM rendering', securityAudit.includes('logs and public subscription metadata are sanitized') && securityAudit.includes('controller and LAN exposure remain locked down') && securityAudit.includes('Tauri ACL remains minimal') && securityAudit.includes('UI renders dynamic user/core text through safe DOM APIs'), 'security gate');
check('stability gate guards repeated blocker classes', stabilityAudit.includes('legacy synchronous delay command is absent') && stabilityAudit.includes('diagnostics stays explicit, detached, and navigation-safe'), 'stability gate');
check('frontend still uses shared optimistic state and safe rendering', appJs.includes('async function runOptimisticAction') && appJs.includes('function replaceChildrenSafe') && appJs.includes('function text(value'), 'optimistic/safe rendering');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
