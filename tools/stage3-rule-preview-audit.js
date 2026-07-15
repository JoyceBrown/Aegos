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
const styles = read('src/styles.css');
const releaseAudit = read('tools/release-audit.js');
const release = exists(`RELEASE_${pkg.version}.md`) ? read(`RELEASE_${pkg.version}.md`) : '';
const previewStart = appJs.indexOf('function renderRoutingDraftPreview');
const previewEnd = appJs.indexOf('function previewWebsiteRoutingDraft', previewStart);
const previewBody = previewStart >= 0 && previewEnd > previewStart ? appJs.slice(previewStart, previewEnd) : '';
const websiteStart = appJs.indexOf('function previewWebsiteRoutingDraft');
const websiteEnd = appJs.indexOf('function normalizeAppRuleInput', websiteStart);
const websiteBody = websiteStart >= 0 && websiteEnd > websiteStart ? appJs.slice(websiteStart, websiteEnd) : '';
const appStart = appJs.indexOf('function previewAppRoutingDraft');
const appEnd = appJs.indexOf('function previewRegionRoutingDraft', appStart);
const appBody = appStart >= 0 && appEnd > appStart ? appJs.slice(appStart, appEnd) : '';

check('version is the 3.5.92 rule preview checkpoint', pkg.version === '3.5.92', pkg.version);
check('package exposes the stage 3 rule preview audit', pkg.scripts?.['audit:stage3-rule-preview'] === 'node tools/stage3-rule-preview-audit.js', 'npm run audit:stage3-rule-preview');

check(
  'preview puts the final user result first',
  previewBody.includes('结果：') &&
    previewBody.includes(' 将 ') &&
    previewBody.includes('状态：已生成未生效草稿') &&
    previewBody.includes('提示：') &&
    previewBody.includes('内部规则：'),
  'result/status/hint/internal-rule preview rows'
);

check(
  'website and app previews use the shared preview renderer',
  websiteBody.includes('renderRoutingDraftPreview(preview, draft, next, parsed.domain)') &&
    appBody.includes('renderRoutingDraftPreview(preview, draft, next, parsed.value)') &&
    !websiteBody.includes('preview.textContent = `\\u9884\\u89c8') &&
    !appBody.includes('preview.textContent = `\\u9884\\u89c8'),
  'shared website/app preview'
);

check(
  'preview remains draft-only and does not apply config or switch nodes',
  previewBody.includes('replaceChildrenSafe') &&
    websiteBody.includes('addRoutingDraft') &&
    appBody.includes('addRoutingDraft') &&
    !websiteBody.includes('runBackgroundJob') &&
    !appBody.includes('runBackgroundJob') &&
    !websiteBody.includes('selectBestProxy') &&
    !appBody.includes('selectBestProxy'),
  'draft-only preview'
);

check(
  'rich preview styles avoid cramped single-line output',
  styles.includes('.routing-draft-preview.is-rich') &&
    styles.includes('.routing-preview-result') &&
    styles.includes('display: grid') &&
    styles.includes('gap: 4px'),
  'rich preview layout'
);

check(
  'release audit knows the stage 3 rule preview gate',
  releaseAudit.includes('stage 3 rule preview audit script exists') &&
    releaseAudit.includes('tools/stage3-rule-preview-audit.js') &&
    releaseAudit.includes('audit:stage3-rule-preview'),
  'tools/release-audit.js'
);

check(
  'release note records plan and verification for 3.5.92',
  release.includes('3.5.92') &&
    release.includes('规则预览') &&
    release.includes('用户规则优先') &&
    release.includes('npm run audit:stage3-rule-preview') &&
    release.includes('Source-only'),
  `RELEASE_${pkg.version}.md`
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
