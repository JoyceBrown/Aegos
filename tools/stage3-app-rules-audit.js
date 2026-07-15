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
const originalRelease = exists('RELEASE_3.5.89.md') ? read('RELEASE_3.5.89.md') : '';
const previewStart = appJs.indexOf('function previewAppRoutingDraft');
const previewEnd = appJs.indexOf('function previewRegionRoutingDraft', previewStart);
const previewBody = previewStart >= 0 && previewEnd > previewStart ? appJs.slice(previewStart, previewEnd) : '';

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

check('version keeps the 3.5.89+ app-rule wizard active', versionAtLeast(pkg.version, '3.5.89'), pkg.version);
check('package exposes the stage 3 app rules audit', pkg.scripts?.['audit:stage3-app-rules'] === 'node tools/stage3-app-rules-audit.js', 'npm run audit:stage3-app-rules');

check(
  'app wizard accepts app names or exe paths in user language',
    appJs.includes('\\u5e94\\u7528\\u89c4\\u5219\\u5411\\u5bfc') &&
    appJs.includes('Telegram.exe 或 C:\\\\Program Files\\\\App\\\\app.exe') &&
    appJs.includes('\\u8f93\\u5165 Telegram \\u4e5f\\u4f1a\\u81ea\\u52a8\\u8865\\u6210 Telegram.exe') &&
    appJs.includes('const isPath = /^[a-z]:') &&
    appJs.includes('raw.includes') &&
    appJs.includes("raw.includes('/')") &&
    appJs.includes('const processName = /\\.exe$/i.test(raw) ? raw') &&
    appJs.includes('`${raw}.exe`'),
  'app/process path input'
);

check(
  'app wizard offers the same plain routing choices as website rules',
  appJs.includes('\\u8fd9\\u4e2a\\u5e94\\u7528') &&
    appJs.includes('\\u9009\\u62e9\\u7ebf\\u8def\\u6216\\u8282\\u70b9') &&
    appJs.includes('\\u76f4\\u8fde\\uff08\\u4e0d\\u8d70\\u4ee3\\u7406\\uff09') &&
    appJs.includes('\\u963b\\u6b62\\u8bbf\\u95ee'),
  'route/node/direct/block choices'
);

check(
  'app preview speaks in user language while generated rule stays internal',
  previewBody.includes('\\u9884\\u89c8\\uff1a') &&
    previewBody.includes('\\u5c06 ') &&
    previewBody.includes('\\u5df2\\u751f\\u6210\\u672a\\u751f\\u6548\\u8349\\u7a3f') &&
    previewBody.includes('kind: parsed.kind') &&
    previewBody.includes('preview.dataset.rule = draft.rule'),
  'plain preview plus generated rule metadata'
);

check(
  'app preview remains draft-only and does not directly write config or switch nodes',
  previewBody.includes('addRoutingDraft') &&
    !previewBody.includes('invoke(') &&
    !previewBody.includes('runBackgroundJob') &&
    !previewBody.includes('set_proxy') &&
    !previewBody.includes('selectBestProxy'),
  'draft-only app preview'
);

check(
  'release audit knows the stage 3 app rules gate',
  releaseAudit.includes('stage 3 app rules audit script exists') &&
    releaseAudit.includes('tools/stage3-app-rules-audit.js') &&
    releaseAudit.includes('audit:stage3-app-rules'),
  'tools/release-audit.js'
);

check(
  'release history records 3.5.89 app wizard and current release keeps verification',
  originalRelease.includes('3.5.89') &&
    originalRelease.includes('应用规则向导') &&
    release.includes('npm run audit:stage3-app-rules') &&
    release.includes('Source-only'),
  `RELEASE_3.5.89.md / RELEASE_${pkg.version}.md`
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
