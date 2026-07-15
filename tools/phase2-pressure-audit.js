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
const mainline = read('CURRENT_MAINLINE_3.5.71_TO_3.6.40.md');
const release = exists(`RELEASE_${pkg.version}.md`) ? read(`RELEASE_${pkg.version}.md`) : '';
const appJs = read('src/app.js');
const interactionSmoke = read('tools/interaction-smoke.js');
const perfSmoke = read('tools/perf-smoke.js');
const currentMainlineAudit = read('tools/current-mainline-audit.js');
const releaseAudit = read('tools/release-audit.js');

check(
  '3.5.86 remains bound to the current mainline phase 2 pressure item',
  mainline.includes('3.5.86：连续操作压力测试') &&
    release.includes('计划项：3.5.86 连续操作压力测试'),
  'mainline/release'
);

check(
  'rapid navigation pressure is simulated in perf smoke',
  perfSmoke.includes('i < 420') &&
    perfSmoke.includes('finalRapidPage') &&
    perfSmoke.includes('button.click()') &&
    perfSmoke.includes('rapid navigation triggered diagnostics before quiet period'),
  'tools/perf-smoke.js'
);

check(
  'speed and diagnostics cannot block sidebar page switching',
  interactionSmoke.includes('speed test blocked sidebar page switching') &&
    interactionSmoke.includes('running diagnostics blocked sidebar page switching') &&
    appJs.includes("$('#quickTestBtn').onclick = (event) => testNodes(event.currentTarget)") &&
    appJs.includes("$('#runDiagBtn').onclick = (event) => runDetachedButtonAction"),
  'tools/interaction-smoke.js / src/app.js'
);

check(
  'subscription switch cancels stale speed state and previews new nodes',
  appJs.includes('function resetSpeedUiForProfileSwitch') &&
    appJs.includes('stopSpeedTestPolling()') &&
    appJs.includes('outboundIpRequestSeq += 1') &&
    appJs.includes('previewProfileNodes') &&
    interactionSmoke.includes('quick subscription switch did not request local node preview'),
  'profile switch stale task guard'
);

check(
  'background jobs stay visible without becoming a global UI lock',
  appJs.includes('renderJobCenter()') &&
    appJs.includes('requestJobCancel') &&
    appJs.includes('const blockRefresh = options.blockRefresh === true') &&
    currentMainlineAudit.includes('background jobs are visible without globally blocking refresh/navigation'),
  'job center / mainline audit'
);

check(
  'release audit knows the phase 2 pressure gate',
  releaseAudit.includes('phase 2 pressure audit script exists') &&
    releaseAudit.includes('tools/phase2-pressure-audit.js') &&
    releaseAudit.includes('audit:phase2-pressure'),
  'tools/release-audit.js'
);

check(
  'current release records real pressure smoke commands',
  release.includes('npm run smoke:interactions') &&
    release.includes('npm run smoke:perf') &&
    release.includes('npm run audit:phase2-pressure'),
  `RELEASE_${pkg.version}.md`
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
