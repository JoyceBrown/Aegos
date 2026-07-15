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
const stylesCss = read('src/styles.css');
const releaseAudit = read('tools/release-audit.js');
const release = exists(`RELEASE_${pkg.version}.md`) ? read(`RELEASE_${pkg.version}.md`) : '';

check('version is the 3.5.87 rules-page redefinition checkpoint', pkg.version === '3.5.87', pkg.version);
check('package exposes the stage 3 rules page audit', pkg.scripts?.['audit:stage3-rules-page'] === 'node tools/stage3-rules-page-audit.js', 'npm run audit:stage3-rules-page');

check(
  'rules page primary entries are website rules, app rules, and system rules',
  appJs.includes("kindButton('website', '\\u7f51\\u7ad9\\u89c4\\u5219'") &&
    appJs.includes("kindButton('app', '\\u5e94\\u7528\\u89c4\\u5219'") &&
    appJs.includes("kindButton('system', '\\u7cfb\\u7edf\\u89c4\\u5219'"),
  'website/app/system buttons'
);

check(
  'old scene entry is not a primary rules-page entry',
  !appJs.includes("kindButton('region'") &&
    !appJs.includes("id: 'routingPanelRegion'") &&
    !appJs.includes("$('#previewRegionRuleBtn')"),
  'no primary region/scenario panel'
);

check(
  'system rules are presented as read-only user explanations',
  appJs.includes("id: 'routingPanelSystem'") &&
    appJs.includes("id: 'routingSystemEntryHint'") &&
    appJs.includes('\\u7cfb\\u7edf\\u89c4\\u5219\\u53ea\\u8bfb') &&
    appJs.includes('\\u843d\\u5730 IP \\u67e5\\u8be2') &&
    appJs.includes('\\u9632\\u6cc4\\u9732\\u4fdd\\u62a4') &&
    appJs.includes("setRoutingSummaryDetail('system')"),
  'system rule explanation panel'
);

check(
  'rules page wording avoids making Mihomo/YAML the primary user concept',
  appJs.includes('\\u4e0d\\u7528\\u5199 YAML') &&
    appJs.includes('\\u6307\\u5b9a\\u54ea\\u4e2a\\u7f51\\u7ad9\\u6216\\u5e94\\u7528\\u8d70\\u54ea\\u6761\\u7ebf\\u8def') &&
    appJs.includes('\\u9009\\u62e9\\u89c4\\u5219\\u5165\\u53e3'),
  'plain-language page definition'
);

check(
  'rules entry layout has responsive system-rule cards',
  stylesCss.includes('.routing-system-entry-grid') &&
    stylesCss.includes('.routing-system-entry') &&
    stylesCss.includes('grid-template-columns: repeat(3, minmax(0, 1fr))') &&
    stylesCss.includes('.routing-system-entry-grid {\n    grid-template-columns: minmax(0, 1fr);'),
  'responsive system entry grid'
);

check(
  'release audit knows the stage 3 rules page gate',
  releaseAudit.includes('stage 3 rules page audit script exists') &&
    releaseAudit.includes('tools/stage3-rules-page-audit.js') &&
    releaseAudit.includes('audit:stage3-rules-page'),
  'tools/release-audit.js'
);

check(
  'release note records plan, deviation, and verification for 3.5.87',
  release.includes('3.5.87') &&
    release.includes('规则页重新定义') &&
    release.includes('网站规则、应用规则、系统规则') &&
    release.includes('npm run audit:stage3-rules-page') &&
    release.includes('Source-only'),
  `RELEASE_${pkg.version}.md`
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
