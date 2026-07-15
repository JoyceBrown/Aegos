import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok: Boolean(ok), detail });
}

function versionAtLeast(version, minimum) {
  const parse = (value) => String(value).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const current = parse(version);
  const target = parse(minimum);
  for (let index = 0; index < Math.max(current.length, target.length); index += 1) {
    const left = current[index] || 0;
    const right = target[index] || 0;
    if (left !== right) return left > right;
  }
  return true;
}

const pkg = JSON.parse(read('package.json'));
const appJs = read('src/app.js');
const styles = read('src/styles.css');
const releaseAudit = read('tools/release-audit.js');
const release = exists(`RELEASE_${pkg.version}.md`) ? read(`RELEASE_${pkg.version}.md`) : '';

check('version keeps the 3.5.99+ UX polish checkpoint active', versionAtLeast(pkg.version, '3.5.99'), pkg.version);
check('package exposes the stage 3 UX polish audit', pkg.scripts?.['audit:stage3-ux-polish'] === 'node tools/stage3-ux-polish-audit.js', 'npm run audit:stage3-ux-polish');

check(
  'rule test has beginner-friendly examples and clearer button copy',
  appJs.includes('routing-test-examples') &&
    appJs.includes('data-routing-test-example') &&
    appJs.includes('youtube.com') &&
    appJs.includes('openai.com') &&
    appJs.includes('telegram.org') &&
    appJs.includes('测试当前规则'),
  'examples and copy'
);

check(
  'rule test has non-blocking local feedback and no global task lock',
  appJs.includes("button.classList.add('is-pending')") &&
    appJs.includes("button.setAttribute('aria-busy', 'true')") &&
    appJs.includes('window.setTimeout') &&
    !appJs.includes("runBackgroundJob('testRouting") &&
    !appJs.includes("invoke('test_routing"),
  'local pending feedback'
);

check(
  'rule test explains unloaded, invalid, miss, and hit states',
  appJs.includes('规则快照还没加载完成') &&
    (appJs.includes('域名格式不对') || appJs.includes('\\u57df\\u540d\\u683c\\u5f0f\\u4e0d\\u5bf9')) &&
    appJs.includes('暂未命中具体网站规则') &&
    appJs.includes('将走') &&
    appJs.includes('用户规则优先'),
  'state copy'
);

check(
  'routing polish has stable hover/focus styles without size jitter',
  styles.includes('.routing-test-card:hover') &&
    styles.includes('.routing-test-card:focus-within') &&
    styles.includes('transition: box-shadow .16s ease, background .16s ease') &&
    styles.includes('.routing-test-examples') &&
    styles.includes('height: 28px'),
  'hover/focus polish'
);

check(
  'release audit and release note record the 3.5.99 gate',
  releaseAudit.includes('stage 3 UX polish audit script exists') &&
    releaseAudit.includes('tools/stage3-ux-polish-audit.js') &&
    releaseAudit.includes('audit:stage3-ux-polish') &&
    release.includes('3.5.99') &&
    release.includes('规则 UX 打磨') &&
    release.includes('npm run audit:stage3-ux-polish') &&
    release.includes('Source-only'),
  `RELEASE_${pkg.version}.md`
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
