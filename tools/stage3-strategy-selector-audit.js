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

const pkg = JSON.parse(read('package.json'));
const appJs = read('src/app.js');
const releaseAudit = read('tools/release-audit.js');
const release = exists(`RELEASE_${pkg.version}.md`) ? read(`RELEASE_${pkg.version}.md`) : '';
const originalRelease = exists('RELEASE_3.5.90.md') ? read('RELEASE_3.5.90.md') : '';
const targetStart = appJs.indexOf('function routingTargetOptions');
const targetEnd = appJs.indexOf('function refreshRoutingTargetOptions', targetStart);
const targetBody = targetStart >= 0 && targetEnd > targetStart ? appJs.slice(targetStart, targetEnd) : '';

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

check('version keeps the 3.5.90+ strategy selector active', versionAtLeast(pkg.version, '3.5.90'), pkg.version);
check('package exposes the stage 3 strategy selector audit', pkg.scripts?.['audit:stage3-strategy-selector'] === 'node tools/stage3-strategy-selector-audit.js', 'npm run audit:stage3-strategy-selector');

check(
  'strategy selector labels backend groups in user language',
  targetBody.includes('\\u81ea\\u52a8\\u6700\\u5feb') &&
    targetBody.includes('\\u624b\\u52a8\\u9009\\u62e9') &&
    targetBody.includes('\\u56fa\\u5b9a\\u8282\\u70b9') &&
    targetBody.includes('\\u76f4\\u8fde') &&
    targetBody.includes('\\u963b\\u6b62') &&
    targetBody.includes('routingTargetDisplayLabel'),
  'automatic/manual/fixed/direct/block labels'
);

check(
  'strategy selector does not expose raw Mihomo group type names as primary option labels',
  !targetBody.includes('label: name') &&
    !targetBody.includes('label: routingStrategyTypeLabel') &&
    targetBody.includes("type === 'urltest'") &&
    targetBody.includes("type === 'fallback'") &&
    targetBody.includes("type === 'loadbalance'"),
  'raw group type hidden behind user labels'
);

check(
  'website and app previews use display labels instead of raw target names',
  appJs.includes('routingTargetDisplayLabel(proxyTarget)') &&
    !appJs.includes('`\\u8d70 ${routingTargetLabel(proxyTarget)}`'),
  'preview route labels'
);

check(
  'release audit knows the stage 3 strategy selector gate',
  releaseAudit.includes('stage 3 strategy selector audit script exists') &&
    releaseAudit.includes('tools/stage3-strategy-selector-audit.js') &&
    releaseAudit.includes('audit:stage3-strategy-selector'),
  'tools/release-audit.js'
);

check(
  'release history records 3.5.90 strategy selector and current release keeps verification',
  originalRelease.includes('3.5.90') &&
    originalRelease.includes('策略选择器') &&
    release.includes('npm run audit:stage3-strategy-selector') &&
    release.includes('Source-only'),
  `RELEASE_3.5.90.md / RELEASE_${pkg.version}.md`
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
