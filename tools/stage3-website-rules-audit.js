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
const originalRelease = exists('RELEASE_3.5.88.md') ? read('RELEASE_3.5.88.md') : '';
const previewStart = appJs.indexOf('function previewWebsiteRoutingDraft');
const previewEnd = appJs.indexOf('function normalizeAppRuleInput', previewStart);
const previewBody = previewStart >= 0 && previewEnd > previewStart ? appJs.slice(previewStart, previewEnd) : '';
const sharedPreviewStart = appJs.indexOf('function renderRoutingDraftPreview');
const sharedPreviewEnd = appJs.indexOf('function previewWebsiteRoutingDraft', sharedPreviewStart);
const sharedPreviewBody = sharedPreviewStart >= 0 && sharedPreviewEnd > sharedPreviewStart ? appJs.slice(sharedPreviewStart, sharedPreviewEnd) : '';

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

check('version keeps the 3.5.88+ website-rule wizard active', versionAtLeast(pkg.version, '3.5.88'), pkg.version);
check('package exposes the stage 3 website rules audit', pkg.scripts?.['audit:stage3-website-rules'] === 'node tools/stage3-website-rules-audit.js', 'npm run audit:stage3-website-rules');

check(
  'website wizard accepts domains or full URLs and extracts the domain',
  appJs.includes('\\u7f51\\u7ad9\\u89c4\\u5219\\u5411\\u5bfc') &&
    (appJs.includes('youtube.com \\u6216 https://www.youtube.com/watch?v=...') ||
      appJs.includes('youtube.com 或 https://www.youtube.com/watch?v=...')) &&
    appJs.includes('input = input.replace(/^https?:') &&
    appJs.includes(".split('/')[0].split('?')[0]"),
  'domain/full URL input'
);

check(
  'website wizard offers plain user choices',
  appJs.includes('\\u9009\\u62e9\\u7ebf\\u8def\\u6216\\u8282\\u70b9') &&
    appJs.includes('\\u76f4\\u8fde\\uff08\\u4e0d\\u8d70\\u4ee3\\u7406\\uff09') &&
    appJs.includes('\\u963b\\u6b62\\u8bbf\\u95ee') &&
    appJs.includes('\\u7ebf\\u8def\\u6216\\u8282\\u70b9'),
  'route/node/direct/block choices'
);

check(
  'website preview speaks in user language instead of exposing DOMAIN-SUFFIX first',
  sharedPreviewBody.includes('结果：') &&
    sharedPreviewBody.includes(' 将 ') &&
    sharedPreviewBody.includes('状态：已生成未生效草稿') &&
    sharedPreviewBody.includes('内部规则：') &&
    previewBody.includes("kind: 'DOMAIN-SUFFIX'") &&
    previewBody.includes('renderRoutingDraftPreview(preview, draft, next, parsed.domain)') &&
    sharedPreviewBody.includes('preview.dataset.rule = draft.rule'),
  'plain preview plus generated rule kept as draft metadata'
);

check(
  'website preview remains draft-only and does not directly write config or switch nodes',
  previewBody.includes('addRoutingDraft') &&
    !previewBody.includes('invoke(') &&
    !previewBody.includes('runBackgroundJob') &&
    !previewBody.includes('set_proxy') &&
    !previewBody.includes('selectBestProxy'),
  'draft-only website preview'
);

check(
  'release audit knows the stage 3 website rules gate',
  releaseAudit.includes('stage 3 website rules audit script exists') &&
    releaseAudit.includes('tools/stage3-website-rules-audit.js') &&
    releaseAudit.includes('audit:stage3-website-rules'),
  'tools/release-audit.js'
);

check(
  'release history records 3.5.88 website wizard and current release keeps verification',
  originalRelease.includes('3.5.88') &&
    originalRelease.includes('网站规则向导') &&
    release.includes('npm run audit:stage3-website-rules') &&
    release.includes('Source-only'),
  `RELEASE_3.5.88.md / RELEASE_${pkg.version}.md`
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
