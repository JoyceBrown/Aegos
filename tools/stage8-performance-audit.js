import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const pkg = JSON.parse(read('package.json'));
const pressureFile = `PERFORMANCE_PRESSURE_${pkg.version}.json`;
const soakFile = `PERFORMANCE_SOAK_${pkg.version}.json`;
const gpuFile = `PERFORMANCE_GPU_${pkg.version}.json`;
const repeatFile = `PERFORMANCE_REPEAT_${pkg.version}.json`;
const pressure = exists(pressureFile) ? JSON.parse(read(pressureFile)) : null;
const soak = exists(soakFile) ? JSON.parse(read(soakFile)) : null;
const gpu = exists(gpuFile) ? JSON.parse(read(gpuFile)) : null;
const repeat = exists(repeatFile) ? JSON.parse(read(repeatFile)) : null;
const app = read('src/app.js');
const release = exists(`RELEASE_${pkg.version}.md`) ? read(`RELEASE_${pkg.version}.md`) : '';
const failures = [];
const passed = [];

function check(name, condition, detail = '') {
  (condition ? passed : failures).push({ name, detail });
}

const severeTasks = pressure?.longTasks?.filter((task) => Number(task.duration || 0) >= 180) || [];
const worstTask = pressure?.longTasks?.reduce((worst, task) => Math.max(worst, Number(task.duration || 0)), 0) || 0;
const samples = soak?.resourceSamples || [];
const settledElements = samples.slice(1).map((sample) => Number(sample.elements || 0));
const settledIntervals = samples.slice(1).map((sample) => Number(sample.timers?.intervals || 0));

check('3.6.32 is the measured performance checkpoint', pkg.version === '3.6.32', pkg.version);
check('performance pressure evidence exists and passed', pressure?.ok === true && pressure?.version === pkg.version, pressureFile);
check('compressed soak evidence exists and passed', soak?.ok === true && soak?.version === pkg.version, soakFile);
check('windowed GPU evidence exists and passed', gpu?.ok === true && gpu?.version === pkg.version && gpu?.fixture?.compositor === 'windowed-gpu', gpuFile);
check('three-run cold-start evidence exists and passed', repeat?.ok === true && repeat?.version === pkg.version && repeat?.runCount === 3, repeatFile);
check('large fixture exercises 8000 nodes in streamed batches', pressure?.fixture?.nodeCount === 8000 && pressure?.fixture?.streamedBatchSize === 420, JSON.stringify(pressure?.fixture || {}));
check('420 rapid navigation changes remain correct', pressure?.nav?.count === 420 && pressure?.nav?.activeFailures?.length === 0 && pressure?.finalRapidPage === pressure?.lastRapidPage, `${pressure?.nav?.count || 0} changes`);
check('ordinary interactions stay below the 50ms P95 budget', Number(pressure?.nav?.p95Ms || Infinity) < 50 && Number(pressure?.menu?.p95Ms || Infinity) < 50 && Number(pressure?.filters?.p95Ms || Infinity) < 50, `nav=${pressure?.nav?.p95Ms} menu=${pressure?.menu?.p95Ms} filters=${pressure?.filters?.p95Ms}`);
check('no main-thread task reaches 300ms', worstTask < 300, `${worstTask}ms`);
check('severe long-task budget is respected', severeTasks.length <= 1, `${severeTasks.length} tasks >=180ms`);
check('streamed speed results complete without backend calls from local filters', pressure?.calls?.speedPollCount >= 20 && pressure?.calls?.callsAddedByFilters === 0, JSON.stringify(pressure?.calls || {}));
check('node DOM stays windowed', pressure?.resources?.visibleRows <= 100 && pressure?.resources?.homeRows <= 8, `${pressure?.resources?.visibleRows}/${pressure?.resources?.homeRows}`);
check('startup status and real home nodes become usable within budget', pressure?.startup?.statusContentMs < 250 && pressure?.startup?.homeNodesContentMs < 300 && pressure?.startup?.backendDispatchGapMs < 30, JSON.stringify(pressure?.startup || {}));
check('cold routing loads immediately after active profile readiness', pressure?.startup?.routingAfterStatusMs <= 30 && pressure?.startup?.coldRoutingContentMs < 260, JSON.stringify(pressure?.startup || {}));
check('realistic navigation has bounded frame pacing and layout shift', pressure?.visualFluidity?.visualNavFrameCount >= 180 && pressure?.visualFluidity?.visualNavP95FrameMs <= 35 && pressure?.visualFluidity?.visualNavMaxFrameMs <= 100 && pressure?.visualFluidity?.unexpectedLayoutShift <= 0.02, JSON.stringify(pressure?.visualFluidity || {}));
check('windowed compositor keeps page transitions bounded', gpu?.visualFluidity?.visualNavFrameCount >= 180 && gpu?.visualFluidity?.visualNavP95FrameMs <= 35 && gpu?.visualFluidity?.visualNavMaxFrameMs <= 100 && gpu?.visualFluidity?.unexpectedLayoutShift <= 0.02, JSON.stringify(gpu?.visualFluidity || {}));
check('three cold starts remain stable rather than passing once by chance', repeat?.metrics?.statusContent?.worst <= 350 && repeat?.metrics?.homeNodesContent?.worst <= 420 && repeat?.metrics?.coldRoutingContent?.worst <= 350 && repeat?.metrics?.layoutShift?.worst <= 0.02, JSON.stringify(repeat?.metrics || {}));
check('first-use page data is dispatched without the historical 550ms wait', pressure?.pageLoad?.connectionsDispatchMs < 120 && pressure?.pageLoad?.routingDispatchMs < 120, `connections=${pressure?.pageLoad?.connectionsDispatchMs} routing=${pressure?.pageLoad?.routingDispatchMs}`);
check('connections and routing content become usable within 400ms', pressure?.pageLoad?.connectionsContentReady === true && pressure?.pageLoad?.connectionsContentMs < 400 && pressure?.pageLoad?.routingContentReady === true && pressure?.pageLoad?.routingContentMs < 400, `connections=${pressure?.pageLoad?.connectionsContentMs} routing=${pressure?.pageLoad?.routingContentMs}`);
check('collapsed routing details create no hidden rule rows', pressure?.pageLoad?.routingHiddenRuleRows === 0, `${pressure?.pageLoad?.routingHiddenRuleRows}`);
check('routing details remain bounded while paging', pressure?.pageLoad?.advancedOpenMs < 150 && pressure?.pageLoad?.routingVisibleAdvancedRows <= 80 && pressure?.pageLoad?.routingRowsAfterNextPage <= 80 && pressure?.pageLoad?.routingPageChanged === true, JSON.stringify(pressure?.pageLoad || {}));
check('local job polling does not duplicate list polling', pressure?.calls?.listJobPollCount === 0, `${pressure?.calls?.listJobPollCount}`);
check('timers return to the steady-state budget', pressure?.resources?.timerStats?.intervals <= 7 && pressure?.resources?.timerStats?.timeouts <= 4, JSON.stringify(pressure?.resources?.timerStats || {}));
check('final DOM stays within the bounded page budget', pressure?.runtime?.domAfter?.nodes <= 4200, `${pressure?.runtime?.domAfter?.nodes || 0} nodes`);
check('compressed soak executes sixteen mixed-operation cycles', soak?.cycles === 16 && Number(soak?.commandCount || 0) > 200 && samples.length >= 5, `${soak?.cycles || 0} cycles / ${soak?.commandCount || 0} commands`);
check('soak DOM reaches a stable plateau', settledElements.length > 0 && Math.max(...settledElements) - Math.min(...settledElements) <= 180, settledElements.join(', '));
check('soak timer count does not grow', settledIntervals.length > 0 && settledIntervals.every((count) => count <= 7), settledIntervals.join(', '));
check('speed result lookup uses a full node index and incremental visible updates', app.includes('for (let index = 0; index < items.length; index += 1) indexNodeItem') && app.includes('updateVisibleNodeDelays(visibleChanges)') && app.includes('updateLatestGroupItems(nextItems)'));
check('release records current before/after metrics and remaining limits', release.includes('592 ms') && release.includes('Cold routing') && release.includes('Windowed GPU') && release.includes('Real airport') && release.includes('npm run audit:stage8-performance'));

const result = { ok: failures.length === 0, failed: failures, passed, evidence: [pressureFile, gpuFile, repeatFile, soakFile], generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
