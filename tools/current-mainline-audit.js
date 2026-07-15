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
const mainline = exists('CURRENT_MAINLINE_3.5.71_TO_3.6.40.md') ? read('CURRENT_MAINLINE_3.5.71_TO_3.6.40.md') : '';
const alignment = exists('PHASE_1_2_ALIGNMENT_3.5.85.md') ? read('PHASE_1_2_ALIGNMENT_3.5.85.md') : '';
const release = exists(`RELEASE_${pkg.version}.md`) ? read(`RELEASE_${pkg.version}.md`) : '';
const appJs = read('src/app.js');
const mainRs = read('src-tauri/src/main.rs');
const releaseAudit = read('tools/release-audit.js');
const outboundIpRefreshBody = mainRs.match(/fn refresh_outbound_ip_detached\(core: Arc<Mutex<CoreManager>>\) -> Result<String, String> \{([\s\S]*?)\n\}/)?.[1] || '';

check(
  'current mainline document exists and owns phases 1-8',
  mainline.includes('Aegos 当前主线：3.5.71 - 3.6.40') &&
    mainline.includes('阶段 1：用户看得见的真相统一') &&
    mainline.includes('阶段 2：操作永远不锁死界面') &&
    mainline.includes('阶段 3：规则页做成普通用户会用的功能') &&
    mainline.includes('阶段 8：3.6.31 - 3.6.40'),
  'CURRENT_MAINLINE_3.5.71_TO_3.6.40.md'
);

check(
  'old routes are explicitly downgraded to future engineering debt',
  mainline.includes('旧路线、旧门禁、旧架构消化计划只能作为后续工程债') &&
    alignment.includes('已降级为以后工程债'),
  'mainline/alignment'
);

check(
  'phase 1 and phase 2 alignment audit exists',
  alignment.includes('阶段 1 对齐') &&
    alignment.includes('阶段 2 对齐') &&
    alignment.includes('3.5.85 落地 IP 查询防卡死') &&
    alignment.includes('3.5.86 连续操作压力测试'),
  'PHASE_1_2_ALIGNMENT_3.5.85.md'
);

check(
  'stale outbound IP query cannot return previous cached IP after node changes',
  outboundIpRefreshBody.includes('current_proxy != selected_proxy') &&
    outboundIpRefreshBody.includes('Outbound IP refresh result ignored because the selected node changed.') &&
    outboundIpRefreshBody.includes('Outbound IP query expired after node changed; retrying will use the current node.') &&
    !/current_proxy != selected_proxy[\s\S]*?return Ok\(fallback\)/.test(outboundIpRefreshBody),
  'refresh_outbound_ip_detached'
);

check(
  'background jobs are visible without globally blocking refresh/navigation',
  appJs.includes('async function runBackgroundJob(kind, payload = {}, options = {})') &&
    appJs.includes('const blockRefresh = options.blockRefresh === true') &&
    appJs.includes('if (blockRefresh) backgroundJobBusy += 1') &&
    appJs.includes('if (blockRefresh) backgroundJobBusy = Math.max(0, backgroundJobBusy - 1)') &&
    !appJs.includes('async function runBackgroundJob(kind, payload = {}, options = {}) {\n  backgroundJobBusy += 1;'),
  'runBackgroundJob'
);

check(
  'release audit knows the current mainline gate',
  releaseAudit.includes('current mainline audit script exists') &&
    releaseAudit.includes('tools/current-mainline-audit.js') &&
    releaseAudit.includes('audit:current-mainline'),
  'tools/release-audit.js'
);

check(
  'current release records mainline verification',
  release.includes('## 计划项') &&
    release.includes('当前主线') &&
    release.includes('npm run audit:current-mainline') &&
    release.includes('cargo check --manifest-path src-tauri/Cargo.toml'),
  `RELEASE_${pkg.version}.md`
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
