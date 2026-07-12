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
const roadmap = read('ROADMAP_3.0.0_TO_3.6.4.md');
const recovery = read('PRODUCT_MATURITY_RECOVERY_PLAN.md');
const detailed = read('PRODUCT_MATURITY_3.4.11_TO_3.4.20_DETAILED.md');
const report = exists('PRODUCT_MATURITY_GAP_REPORT.md') ? read('PRODUCT_MATURITY_GAP_REPORT.md') : '';
const releaseAudit = read('tools/release-audit.js');
const maturityAudit = read('tools/maturity-gate-audit.js');
const interactionSmoke = read('tools/interaction-smoke.js');
const perfSmoke = read('tools/perf-smoke.js');
const appJs = read('src/app.js');
const mainRs = read('src-tauri/src/main.rs');
const indexHtml = read('src/index.html');

function bodyBetween(text, start, end) {
  const from = text.indexOf(start);
  if (from < 0) return '';
  const to = text.indexOf(end, from + start.length);
  return to > from ? text.slice(from, to) : text.slice(from);
}

const pages = ['home', 'nodes', 'connections', 'profiles', 'routing', 'diagnostics', 'logs', 'settings'];
const productSurfaces = [
  '首页',
  '节点',
  '连接',
  '订阅',
  '分流',
  '诊断',
  '日志',
  '设置',
  '安装',
  '安全',
  '性能',
];
const versions = Array.from({ length: 10 }, (_, index) => `3.4.${11 + index}`);
const blockerClasses = [
  '测速误连接',
  '诊断锁页',
  '订阅切换串状态',
  '落地 IP 过期',
  '按钮卡死',
  '布局跳动',
  '日志未脱敏',
];
const speedBody = bodyBetween(mainRs, 'fn start_proxy_delay_test_for_run', 'fn test_single_proxy_delay_for_run');
const singleSpeedBody = bodyBetween(mainRs, 'fn test_single_proxy_delay_for_run', 'fn probe_proxy_network');

check('product maturity audit is exposed as package script', packageJson.includes('"audit:product-maturity": "node tools/product-maturity-audit.js"'), 'package.json');
check('release audit knows product maturity gate', releaseAudit.includes('product maturity audit script exists'), 'tools/release-audit.js');
check('maturity audit knows 3.4.11 to 3.4.20 recovery lane', versions.every((version) => maturityAudit.includes(version)), 'tools/maturity-gate-audit.js');
check('package version is inside product maturity recovery lane', /^3\.4\.(?:1[1-9]|20)$/.test(pkg.version), pkg.version);
check('main roadmap pauses 3.5.x until whole-product maturity passes', roadmap.includes('全软件产品成熟度补课路线') && roadmap.includes('3.5.x 在 3.4.20 通过前暂停推进'), 'roadmap stop gate');
check('recovery plan references detailed execution table', recovery.includes('PRODUCT_MATURITY_3.4.11_TO_3.4.20_DETAILED.md'), 'PRODUCT_MATURITY_RECOVERY_PLAN.md');
check('detailed plan covers every 3.4.11 to 3.4.20 checkpoint', versions.every((version) => detailed.includes(`## ${version}`)), versions.join(', '));
check('gap report exists for 3.4.11', exists('PRODUCT_MATURITY_GAP_REPORT.md'), 'PRODUCT_MATURITY_GAP_REPORT.md');
check('gap report covers all product surfaces', productSurfaces.every((surface) => report.includes(surface)), productSurfaces.join(', '));
check('gap report uses engineering/product/mature grading', ['工程完成', '产品可用', '成熟可交付'].every((text) => report.includes(text)), 'three-grade maturity model');
check('gap report lists known blocker classes from prior regressions', blockerClasses.every((text) => report.includes(text)), blockerClasses.join(', '));
check('gap report explicitly blocks 3.5.x on unresolved maturity gaps', report.includes('阻止进入 3.5.x') && report.includes('3.4.20'), '3.5 stop condition');
check('all primary pages remain present in DOM', pages.every((page) => indexHtml.includes(`data-page="${page}"`) && indexHtml.includes(`data-page-panel="${page}"`)), pages.join(', '));
check('frontend has non-blocking navigation and local page cache', appJs.includes('function setPage') && appJs.includes('schedulePageLoad') && appJs.includes('pageCacheState') && appJs.includes('runWhenIdle'), 'navigation/cache');
check('speed tests remain measurement-only in implementation and smoke', mainRs.includes('ensure_core_for_delay_test') && !speedBody.includes('change_proxy') && !speedBody.includes('select_best_proxy') && !singleSpeedBody.includes('change_proxy') && !singleSpeedBody.includes('select_best_proxy') && interactionSmoke.includes('speed test triggered a proxy switch'), 'speed no auto-connect');
check('diagnostics and speed regressions are covered by smoke/perf gates', interactionSmoke.includes('running diagnostics blocked sidebar page switching') && perfSmoke.includes('i < 420'), 'smoke coverage');
check('report captures real-user task smoke requirement', report.includes('真实用户任务 smoke') && report.includes('导入订阅') && report.includes('创建分流规则'), 'real user task smoke');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
