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
const outboundIpRefreshBody = mainRs.match(/fn refresh_outbound_ip_detached\(core: Arc<Mutex<CoreManager>>\) -> Result<String, String> \{([\s\S]*?)\n\}/)?.[1] || '';

check('current mainline document owns the 3.5.71-3.6.40 product line', mainline.includes('3.5.71') && mainline.includes('3.6.40') && mainline.includes('3.6.8'), 'CURRENT_MAINLINE_3.5.71_TO_3.6.40.md');
check('phase 1 and 2 alignment record remains available', alignment.includes('3.5.85') && alignment.includes('3.5.86'), 'PHASE_1_2_ALIGNMENT_3.5.85.md');
check('stale outbound IP query cannot return previous cached IP after node changes', outboundIpRefreshBody.includes('current_proxy != selected_proxy') && outboundIpRefreshBody.includes('Outbound IP refresh result ignored because the selected node changed.') && outboundIpRefreshBody.includes('Outbound IP query expired after node changed; retrying will use the current node.') && !/current_proxy != selected_proxy[\s\S]*?return Ok\(fallback\)/.test(outboundIpRefreshBody), 'refresh_outbound_ip_detached');
check('background jobs are visible without globally blocking refresh/navigation', appJs.includes('async function runBackgroundJob(kind, payload = {}, options = {})') && appJs.includes('const blockRefresh = options.blockRefresh === true') && appJs.includes('if (blockRefresh) backgroundJobBusy += 1') && appJs.includes('if (blockRefresh) backgroundJobBusy = Math.max(0, backgroundJobBusy - 1)') && !appJs.includes('async function runBackgroundJob(kind, payload = {}, options = {}) {\n  backgroundJobBusy += 1;'), 'runBackgroundJob');
check('release audit knows the current mainline gate', releaseAudit.includes('current mainline audit script exists') && releaseAudit.includes('tools/current-mainline-audit.js') && releaseAudit.includes('audit:current-mainline'), 'tools/release-audit.js');
check('current release records the carried mainline verification', release.includes('3.5.71 - 3.6.40') && release.includes('npm run audit:current-mainline') && release.includes('cargo check --manifest-path src-tauri/Cargo.toml'), `RELEASE_${pkg.version}.md`);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
