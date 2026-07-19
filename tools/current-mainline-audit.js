import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const exists = (rel) => fs.existsSync(path.join(root, rel));
const check = (name, ok, detail = '') => (ok ? pass : fail).push({ name, ok: Boolean(ok), detail });

const pkg = JSON.parse(read('package.json'));
const mainline = exists('CURRENT_MAINLINE_3.5.71_TO_3.6.40.md') ? read('CURRENT_MAINLINE_3.5.71_TO_3.6.40.md') : '';
const alignment = exists('PHASE_1_2_ALIGNMENT_3.5.85.md') ? read('PHASE_1_2_ALIGNMENT_3.5.85.md') : '';
const release = exists(`RELEASE_${pkg.version}.md`) ? read(`RELEASE_${pkg.version}.md`) : '';
const appJs = read('src/app.js');
const mainRs = read('src-tauri/src/main.rs');
const releaseAudit = read('tools/release-audit.js');
const handoff = exists('DEVELOPMENT_HANDOFF_3.6.35.md') ? read('DEVELOPMENT_HANDOFF_3.6.35.md') : '';

function sliceBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return start >= 0 && end > start ? source.slice(start, end) : '';
}

const outboundIpRefreshBody = sliceBetween(mainRs, 'fn refresh_outbound_ip_detached', 'fn update_all_profiles_detached');
const identityCheckIndex = outboundIpRefreshBody.indexOf('if !outbound_ip_query_is_current(');
const staleReturnIndex = outboundIpRefreshBody.indexOf('Outbound IP query expired after node changed; retrying will use the current node.');
const fallbackIndex = outboundIpRefreshBody.indexOf('let fallback = core.outbound_ip_cache.trim().to_string()');
const currentReleaseRecordsMainline = release.includes('3.5.71 - 3.6.40') && release.includes('npm run audit:current-mainline') && release.includes('cargo check --manifest-path src-tauri/Cargo.toml');
const publishedBaselineDebtIsRecorded = pkg.version === '3.6.35' &&
  handoff.includes('交接时 `npm run audit:current-mainline` 失败两项') &&
  handoff.includes('交接后的首轮维护已修正上述门禁') &&
  handoff.includes('`RELEASE_3.6.35.md` 和 `v3.6.35` 标签保持不变') &&
  handoff.includes('下一版本仍须在新 Release Note 中记录真实证据');

check('current mainline document owns the 3.5.71-3.6.40 product line', mainline.includes('3.5.71') && mainline.includes('3.6.40') && mainline.includes('3.6.8'), 'CURRENT_MAINLINE_3.5.71_TO_3.6.40.md');
check('phase 1 and 2 alignment record remains available', alignment.includes('3.5.85') && alignment.includes('3.5.86'), 'PHASE_1_2_ALIGNMENT_3.5.85.md');
check('stale outbound IP query cannot return previous cached IP after runtime identity changes', mainRs.includes('fn outbound_ip_query_is_current(') && mainRs.includes('fn outbound_ip_query_identity_rejects_stale_contexts()') && identityCheckIndex >= 0 && staleReturnIndex > identityCheckIndex && fallbackIndex > staleReturnIndex, 'generation/profile/mode/proxy behavior test plus stale return before cached fallback');
check('background jobs are visible without globally blocking refresh/navigation', appJs.includes('async function runBackgroundJob(kind, payload = {}, options = {})') && appJs.includes('const blockRefresh = options.blockRefresh === true') && appJs.includes('if (blockRefresh) backgroundJobBusy += 1') && appJs.includes('if (blockRefresh) backgroundJobBusy = Math.max(0, backgroundJobBusy - 1)') && !appJs.includes('async function runBackgroundJob(kind, payload = {}, options = {}) {\n  backgroundJobBusy += 1;'), 'runBackgroundJob');
check('release audit knows the current mainline gate', releaseAudit.includes('current mainline audit script exists') && releaseAudit.includes('tools/current-mainline-audit.js') && releaseAudit.includes('audit:current-mainline'), 'tools/release-audit.js');
check('mainline verification is documented without rewriting a published release', currentReleaseRecordsMainline || publishedBaselineDebtIsRecorded, currentReleaseRecordsMainline ? `RELEASE_${pkg.version}.md` : '3.6.35 handoff exception; the next release note must record the gate');

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
