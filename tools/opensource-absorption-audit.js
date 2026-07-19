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

const standardPath = 'research/opensource-absorption-standard.md';
const referencePath = 'research/opensource-reference.md';
const absorptionRoadmapPath = 'research/opensource-absorption-roadmap.md';
const canonicalRoadmapPath = 'ROADMAP_3.0.0_TO_3.6.4.md';
const coreApiContractPath = 'core-api-contract.md';

const pkg = readJson('package.json');
const releaseAudit = read('tools/release-audit.js');
const standard = exists(standardPath) ? read(standardPath) : '';
const reference = exists(referencePath) ? read(referencePath) : '';
const absorptionRoadmap = exists(absorptionRoadmapPath) ? read(absorptionRoadmapPath) : '';
const canonicalRoadmap = exists(canonicalRoadmapPath) ? read(canonicalRoadmapPath) : '';
const coreApiContract = exists(coreApiContractPath) ? read(coreApiContractPath) : '';

const requiredStandardSections = [
  '## 1. \u603b\u539f\u5219',
  '### 1.1 \u5438\u6536\u4e0d\u662f\u590d\u5236',
  '## 2. \u6807\u51c6\u6d41\u7a0b',
  '### 2.1 \u7b2c\u4e00\u6b65\uff1a\u6765\u6e90\u6838\u9a8c',
  '### 2.2 \u7b2c\u4e8c\u6b65\uff1a\u5bf9\u6bd4',
  '### 2.3 \u7b2c\u4e09\u6b65\uff1a\u8bc4\u4f30',
  '### 2.4 \u7b2c\u56db\u6b65\uff1a\u62c6\u89e3\u7ed3\u6784',
  '### 2.5 \u7b2c\u4e94\u6b65\uff1a\u9009\u62e9\u5438\u6536\u8def\u7ebf',
  '### 2.6 \u7b2c\u516d\u6b65\uff1a\u878d\u5408\u5b9e\u73b0',
  '### 2.7 \u7b2c\u4e03\u6b65\uff1a\u9a8c\u6536',
  '## 3. \u5f53\u524d\u9879\u76ee\u5438\u6536\u5224\u5b9a',
  '## 5. \u7981\u6b62\u6e05\u5355',
  '## 6. \u5438\u6536\u4efb\u52a1\u6a21\u677f',
];

const requiredProjects = [
  'mihomo',
  'FlClash',
  'Clash Verge Rev',
  'MetaCubeXD',
  'v2rayN',
  'Hiddify',
  'sing-box',
  'NekoBox',
  'snell.sh',
];

const requiredRoutes = [
  '\u8def\u7ebf A\uff1a\u5951\u7ea6\u5438\u6536',
  '\u8def\u7ebf B\uff1a\u7b56\u7565\u91cd\u5199',
  '\u8def\u7ebf C\uff1a\u9002\u914d\u5c42\u878d\u5408',
  '\u8def\u7ebf D\uff1a\u4f9d\u8d56\u5f15\u5165',
  '\u8def\u7ebf E\uff1a\u4e0d\u5438\u6536\uff0c\u53ea\u8bb0\u5f55',
];

const requiredSourceUrls = [
  'https://github.com/chen08209/FlClash',
  'https://github.com/clash-verge-rev/clash-verge-rev',
  'https://github.com/2dust/v2rayN',
  'https://github.com/hiddify/hiddify-app',
  'https://github.com/SagerNet/sing-box',
  'https://wiki.metacubex.one/en/api/',
  'https://github.com/MetaCubeX/metacubexd',
  'https://github.com/jinqians/snell.sh',
];

check('opensource absorption standard exists', exists(standardPath), standardPath);
check('opensource reference exists', exists(referencePath), referencePath);
check('opensource absorption roadmap exists', exists(absorptionRoadmapPath), absorptionRoadmapPath);
check('canonical 3.x roadmap exists', exists(canonicalRoadmapPath), canonicalRoadmapPath);
check('mihomo core API contract exists', exists(coreApiContractPath), coreApiContractPath);
check('package exposes audit:opensource', pkg.scripts?.['audit:opensource'] === 'node tools/opensource-absorption-audit.js', 'package.json');
check('release audit knows opensource absorption gate', releaseAudit.includes('opensource absorption audit script exists'), 'tools/release-audit.js');
check('standard contains required sections', requiredStandardSections.every((section) => standard.includes(section)), requiredStandardSections.join(', '));
check('standard defines all absorption routes', requiredRoutes.every((route) => standard.includes(route)), requiredRoutes.join(', '));
check('standard covers compare/evaluate/decompose/fuse/acceptance', ['\u5bf9\u6bd4', '\u8bc4\u4f30', '\u62c6\u89e3', '\u878d\u5408', '\u9a8c\u6536'].every((word) => standard.includes(word)), 'core workflow words');
check('standard explicitly forbids direct GPL/code/asset copying', ['GPL', '\u76f4\u63a5\u590d\u5236', '\u56fe\u6807', '\u6837\u5f0f', '\u8bb8\u53ef\u8bc1'].every((word) => standard.includes(word)) && standard.includes('\u9ed8\u8ba4\u7981\u6b62'), 'license/copy boundary');
check('standard preserves Aegos non-negotiable behavior', ['\u6d4b\u901f\u53ea\u6d4b\u5ef6\u8fdf', '\u7edd\u4e0d\u5207\u6362\u5f53\u524d\u8282\u70b9', '\u4e0d\u80fd\u9501\u6b7b\u5bfc\u822a', '\u65e5\u5fd7\u548c\u8bca\u65ad\u5fc5\u987b\u8131\u654f', '\u914d\u7f6e\u5199\u5165\u5fc5\u987b\u539f\u5b50\u66ff\u6362'].every((text) => standard.includes(text)), 'Aegos guardrails');
check('standard has scoring gate', ['\u603b\u5206\u4e0d\u5c11\u4e8e 10', '\u7528\u6237\u4ef7\u503c\u81f3\u5c11 2', '\u98ce\u9669\u81f3\u5c11 2', '\u9a8c\u6536\u53ef\u6d4b\u6027\u81f3\u5c11 2'].every((text) => standard.includes(text)), 'score threshold');
check('standard applies routes to required projects', requiredProjects.every((project) => standard.includes(project)), requiredProjects.join(', '));
check('reference records source verification date', reference.includes('\u6765\u6e90\u6838\u9a8c\u65e5\u671f\uff1a2026-07-12'), 'source verification date');
check('reference includes required source URLs', requiredSourceUrls.every((url) => reference.includes(url)), requiredSourceUrls.join(', '));
check('reference includes priority task table', reference.includes('## 5. Aegos \u8fd1\u671f\u4efb\u52a1\u8868') && reference.includes('| \u7248\u672c | \u4efb\u52a1 | \u53c2\u8003\u6765\u6e90 | \u9a8c\u6536\u6807\u51c6 |'), 'near-term task table');
check('reference classifies snell.sh as server script, not client dependency', reference.includes('\u670d\u52a1\u7aef\u90e8\u7f72\u811a\u672c') && reference.includes('\u4e0d\u9002\u5408\u5728 Aegos \u5ba2\u6237\u7aef\u9ed8\u8ba4\u6267\u884c\u8fdc\u7a0b shell'), 'snell.sh boundary');
check('absorption roadmap declares canonical execution plan', absorptionRoadmap.includes('Canonical execution plan') && absorptionRoadmap.includes('does not define independent'), 'canonical route');
check('absorption roadmap maps required projects to canonical lanes', requiredProjects.every((project) => absorptionRoadmap.includes(project)) && ['3.1.x', '3.2.x', '3.3.x', '3.4.x', '3.5.x', '3.6.x'].every((lane) => absorptionRoadmap.includes(lane)), 'project lane matrix');
check(
  'absorption roadmap preserves no-copy and validation gates',
  ['Do not copy GPL code', 'Every absorbed item needs an audit', 'Do not execute server-side shell scripts'].every((text) => absorptionRoadmap.includes(text)) &&
    absorptionRoadmap.includes('must first be') &&
    absorptionRoadmap.includes('merged into the canonical roadmap'),
  'fusion and stop gates'
);
check('absorption roadmap resolves 3.3 manual-node conflict', absorptionRoadmap.includes('3.3.x remains the routing-assistant lane') && absorptionRoadmap.includes('Manual-node and protocol-field maturity moves to 3.6.x'), '3.3 conflict resolved');
check('absorption roadmap keeps sing-box and snell out of the immediate mainline', absorptionRoadmap.includes('sing-box runtime experiments require a separate architecture') && absorptionRoadmap.includes('no remote shell execution by default'), 'deferred high-risk projects');
check(
  'canonical roadmap declares single source of truth',
  canonicalRoadmap.includes('\u552f\u4e00\u4e3b\u89c4\u5212\u89c4\u5219') &&
    canonicalRoadmap.includes('\u672c\u6587\u4ef6\u662f\u7248\u672c\u6267\u884c\u7684\u552f\u4e00\u4e8b\u5b9e\u6765\u6e90'),
  canonicalRoadmapPath
);
check(
  'canonical roadmap keeps 3.3 as routing assistant',
  (canonicalRoadmap.includes('3.3.x \u56fa\u5b9a\u4e3a\u5206\u6d41\u52a9\u624b\u8def\u7ebf') ||
    canonicalRoadmap.includes('3.3.x \u56fa\u5b9a\u4e3a\u5206\u6d41\u52a9\u624b\u5730\u57fa\u8def\u7ebf')) &&
    canonicalRoadmap.includes('| 3.3.4 | \u5730\u533a/\u7b56\u7565\u76ee\u6807\u5411\u5bfc |'),
  '3.3.x route'
);
check(
  'canonical roadmap moves manual node maturity to 3.6.x',
  canonicalRoadmap.includes('\u624b\u52a8\u8282\u70b9\u548c\u534f\u8bae\u5b57\u6bb5\u6210\u719f\u5316') &&
    canonicalRoadmap.includes('| 3.6.3 | \u56fa\u5b9a\u8282\u70b9\u534f\u8bae\u5b57\u6bb5 |') &&
    canonicalRoadmap.includes('| 3.6.4 | \u56fa\u5b9a\u8282\u70b9\u589e\u5220\u6539\u67e5/\u5bfc\u5165\u5bfc\u51fa\u9a8c\u6536 |'),
  '3.6.x route'
);
check('canonical roadmap has no conflicting 3.3 manual-node route', !/3\.3\.[0-9][^\n]*(manual node|Manual node|Fixed node|protocol field|URI import)/.test(canonicalRoadmap), 'no 3.3 manual-node conflict');
check('core API contract records current mihomo controller envelope', ['CoreController::request', 'controller_request', '127.0.0.1', 'bearer auth', 'no_proxy'].every((text) => coreApiContract.includes(text)), 'controller envelope');
check('core API contract classifies read, measurement, and mutating APIs', ['GET /proxies', 'GET /proxies/{name}/delay', 'PUT /proxies/{group}', 'PATCH /configs', 'GET /traffic', 'GET /connections', 'DELETE /connections'].every((text) => coreApiContract.includes(text)), 'API matrix');
check('core API contract forbids speed-test proxy switching', ['Delay tests are measurement-only', 'Forbidden in this path', 'PUT /proxies/{group}', 'selected proxy map mutation'].every((text) => coreApiContract.includes(text)), 'measurement-only contract');
check('core API contract gates dangerous group delay semantics', coreApiContract.includes('GET /group/{name}/delay') && coreApiContract.includes('clear fixed selection') && coreApiContract.includes('Prefer `/proxies/{name}/delay`'), 'group delay gate');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
