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
const roadmapPath = 'research/opensource-absorption-roadmap.md';
const pkg = readJson('package.json');
const releaseAudit = read('tools/release-audit.js');
const standard = exists(standardPath) ? read(standardPath) : '';
const reference = exists(referencePath) ? read(referencePath) : '';
const roadmap = exists(roadmapPath) ? read(roadmapPath) : '';

const requiredStandardSections = [
  '## 1. 总原则',
  '### 1.1 吸收不是复制',
  '## 2. 标准流程',
  '### 2.1 第一步：来源核验',
  '### 2.2 第二步：对比',
  '### 2.3 第三步：评估',
  '### 2.4 第四步：拆解结构',
  '### 2.5 第五步：选择吸收路线',
  '### 2.6 第六步：融合实现',
  '### 2.7 第七步：验收',
  '## 3. 当前项目吸收判定',
  '## 5. 禁止清单',
  '## 6. 吸收任务模板',
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
  '路线 A：契约吸收',
  '路线 B：策略重写',
  '路线 C：适配层融合',
  '路线 D：依赖引入',
  '路线 E：不吸收，只记录',
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
check('opensource absorption roadmap exists', exists(roadmapPath), roadmapPath);
check('package exposes audit:opensource', pkg.scripts?.['audit:opensource'] === 'node tools/opensource-absorption-audit.js', 'package.json');
check('release audit knows opensource absorption gate', releaseAudit.includes('opensource absorption audit script exists'), 'tools/release-audit.js');
check('standard contains required sections', requiredStandardSections.every((section) => standard.includes(section)), requiredStandardSections.join(', '));
check('standard defines all absorption routes', requiredRoutes.every((route) => standard.includes(route)), requiredRoutes.join(', '));
check('standard covers compare/evaluate/decompose/fuse/acceptance', ['对比', '评估', '拆解', '融合', '验收'].every((word) => standard.includes(word)), 'core workflow words');
check('standard explicitly forbids direct GPL/code/asset copying', ['GPL', '直接复制', '图标', '样式', '许可证'].every((word) => standard.includes(word)) && standard.includes('默认禁止'), 'license/copy boundary');
check('standard preserves Aegos non-negotiable behavior', ['测速只测延迟', '绝不切换当前节点', '不能锁死导航', '日志和诊断必须脱敏', '配置写入必须原子替换'].every((text) => standard.includes(text)), 'Aegos guardrails');
check('standard has scoring gate', ['总分不少于 10', '用户价值至少 2', '风险至少 2', '验收可测性至少 2'].every((text) => standard.includes(text)), 'score threshold');
check('standard applies routes to required projects', requiredProjects.every((project) => standard.includes(project)), requiredProjects.join(', '));
check('reference records source verification date', reference.includes('来源核验日期：2026-07-12'), 'source verification date');
check('reference includes required source URLs', requiredSourceUrls.every((url) => reference.includes(url)), requiredSourceUrls.join(', '));
check('reference includes priority task table', reference.includes('## 5. Aegos 近期任务表') && reference.includes('| 版本 | 任务 | 参考来源 | 验收标准 |'), 'near-term task table');
check('reference classifies snell.sh as server script, not client dependency', reference.includes('服务端部署脚本') && reference.includes('不适合在 Aegos 客户端默认执行远程 shell'), 'snell.sh boundary');
check('roadmap applies scoring standard to projects', requiredProjects.every((project) => roadmap.includes(project)) && ['用户价值', '技术适配', '风险', '可测性', '时机', '总分'].every((text) => roadmap.includes(text)), 'project score matrix');
check('roadmap maps absorption into versions', ['2.9.53', '2.9.54', '2.9.55', '2.9.56', '3.1.0', '3.2.0', '3.3.0', '3.4.0', '3.5.0', '4.0.0'].every((version) => roadmap.includes(version)), 'version route');
check('roadmap preserves no-copy and validation gates', ['不复制', '融合方式', '验收', '停止条件', '测速仍会自动切节点'].every((text) => roadmap.includes(text)), 'fusion and stop gates');
check('roadmap keeps sing-box and snell out of the immediate mainline', roadmap.includes('不进 3.0 主线') && roadmap.includes('不执行服务端 shell'), 'deferred high-risk projects');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
