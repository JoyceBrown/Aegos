import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = [];
const pass = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

const pkg = readJson('package.json');
const indexHtml = read('src/index.html');
const appJs = read('src/app.js');
const perfSmoke = read('tools/perf-smoke.js');
const interactionSmoke = read('tools/interaction-smoke.js');
const releaseAudit = read('tools/release-audit.js');

check('package version keeps 3.x routing navigation gate active', /^3\.\d+\.\d+$/.test(pkg.version), pkg.version);
check('routing nav button and panel are wired', indexHtml.includes('data-page="routing"') && indexHtml.includes('data-page-panel="routing"'), 'routing nav/panel');
check('routing page load is deferred through page scheduler', appJs.includes("if (page === 'routing' && shouldRefreshPageCache(page)) void loadRoutingPage(token)") && appJs.includes("routing: { loaded: false, loading: false, updatedAt: 0 }"), 'schedulePageLoad/pageCacheState');
check('routing snapshot rendering is token- and generation-cancellable', appJs.includes("if (!isCurrentPageTask(token, 'routing')) return;") && appJs.includes("generation !== routingRenderGeneration") && appJs.includes("recordUiPerformance('routing-render-cancelled'") && appJs.includes("invoke('routing_snapshot'"), 'token/generation guarded invoke and render');
const routingRenderer = appJs.slice(appJs.indexOf('async function renderRoutingSnapshot'), appJs.indexOf('async function submitRoutingRuleForm'));
check('routing snapshot defers Rules DOM work until segmented preparation still owns the page', routingRenderer.indexOf('const partitions = await splitRoutingRules') >= 0 && routingRenderer.indexOf('ensureRoutingAssistantUi()') > routingRenderer.indexOf('const partitions = await splitRoutingRules'), 'partition-before-DOM ordering');
check('routing refresh is detached and does not foreground-lock UI', appJs.includes("runDetachedButtonAction(event.currentTarget, '刷新中...', () => refreshRoutingSnapshot())") && !appJs.includes("runButtonAction(event.currentTarget, '刷新中...', () => refreshRoutingSnapshot())"), 'detached refresh');
check('perf smoke includes routing in rapid navigation, stale-DOM, and R5 known-bad controls', perfSmoke.includes("'routing'") && perfSmoke.includes('rapid navigation triggered routing before quiet period') && perfSmoke.includes('routing-to-connections input was blocked after snapshot return') && perfSmoke.includes('stale routing snapshot render was not cancelled after switching to Connections') && perfSmoke.includes('stale routing snapshot committed Rules DOM after switching to Connections') && perfSmoke.includes('--r5-known-bad') && perfSmoke.includes('staleSnapshotCommitted'), 'perf routing coverage');
check('interaction smoke asserts immediate routing activation and stale cancellation', interactionSmoke.includes('routing navigation did not activate on pointerdown') && interactionSmoke.includes('routing page panel did not activate immediately') && interactionSmoke.includes('stale routing data load was not cancelled'), 'interaction routing coverage');
check('routing audit is wired into release gate', releaseAudit.includes('routing navigation audit script exists'), 'release-audit');

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
