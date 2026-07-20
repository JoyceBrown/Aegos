import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')
const main = read('src-tauri/src/main.rs')
const scheduler = read('src-tauri/src/speed_scheduler.rs')
const runtime = read('src-tauri/src/speed_runtime.rs')
const configPipeline = read('src-tauri/src/config_pipeline.rs')
const app = read('src/app.js')
const interaction = read('tools/interaction-smoke.js')
const perf = read('tools/perf-smoke.js')

const between = (source, start, end) => {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  return from >= 0 && to > from ? source.slice(from, to) : ''
}

const batch = between(main, 'fn start_proxy_delay_test_for_run', 'fn test_single_proxy_delay_for_run')
const single = between(main, 'fn test_single_proxy_delay_for_run', 'fn probe_proxy_network')
const singleWait = between(app, 'async function waitForSingleNodeDelay', 'async function testSingleNode')
const startupWarmup = between(app, 'function scheduleSpeedRuntimeWarmup', 'function stopSpeedTestPolling')
const startupAuto = between(app, 'function scheduleStartupAutoSpeedTest', 'function stopSpeedTestPolling')
const testNodes = between(app, 'async function testNodes', 'async function refreshOutboundIpJob')
const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })

check(
  'Aegos owns one non-blocking startup speed test while core auto groups stay lazy',
  main.includes('fn prepare_speed_runtime') &&
    main.includes('prepare_speed_measurement_runtime') &&
    app.includes('function scheduleSpeedRuntimeWarmup') &&
    startupWarmup.includes("invoke('prepare_speed_runtime')") &&
    startupWarmup.includes('requestAnimationFrame(() =>') &&
    startupAuto.includes('startupAutoSpeedScheduled || startupAutoSpeedStarted') &&
    startupAuto.includes('startupAutoSpeedStarted = true') &&
    startupAuto.includes("invoke('prepare_speed_runtime')") &&
    startupAuto.includes("testNodes(null, { automatic: true })") &&
    testNodes.includes("invoke('start_proxy_delay_test'") &&
    !testNodes.includes("runBackgroundJob('changeProxy'") &&
    !testNodes.includes('selectBestProxyJob') &&
    interaction.includes('startup did not launch exactly one Aegos-managed first speed test') &&
    interaction.includes('startup speed test changed the connection or selected proxy') &&
    configPipeline.includes('set_yaml(&mut group, "lazy", YamlValue::Bool(true))') &&
    configPipeline.includes('set_yaml(map, "lazy", YamlValue::Bool(true))'),
  'Mihomo does not probe independently; Aegos starts exactly one measurement-only first pass after startup data is ready'
)

check(
  'target catalog is profile and config keyed',
  main.includes('struct SpeedTargetCatalog') &&
    main.includes('fn speed_target_catalog_key') &&
    main.includes('runtime_config_digest') &&
    main.includes('self.speed_target_catalog = None') &&
    batch.includes('self.speed_targets()'),
  'node parsing must be cached and invalidated on subscription changes'
)

check(
  'batch probes use a bounded reusable worker pool',
  scheduler.includes('sync_channel::<Option<(QueuedTarget<T>, String)>>') &&
    scheduler.includes('let worker_count = policy.max_concurrency') &&
    scheduler.includes('family_limits') &&
    scheduler.includes('fn adaptive_concurrency') &&
    batch.includes('run_probe_wave') &&
    !batch.includes('handles.push(thread::spawn'),
  'node count must not equal operating-system thread count'
)

check(
  'fast pass and background refinement have separate terminal semantics',
  batch.includes('speed_scheduler_policy(false)') &&
    batch.includes('speed_scheduler_policy(true)') &&
    batch.includes('refining_node_health') &&
    batch.includes('"kind": "fast-complete"') &&
    batch.includes('"kind": "refined"') &&
    batch.includes('"kind": "complete"') &&
    app.includes("kind === 'fast-complete'") &&
    app.includes("kind === 'result' || kind === 'refined'"),
  'quick timeout is not a final failure and slow protocols refine in background'
)

check(
  'status signatures and watchdog progress are constant time',
  runtime.includes('pub revision: u64') &&
    runtime.includes('pub fn speed_test_progress_snapshot') &&
    runtime.includes('speed.revision') &&
    !runtime.includes('parts.sort()') &&
    main.includes('fn speed_test_progress') &&
    app.includes("speedEventReady ? 'speed_test_progress' : 'speed_test_status'"),
  'polling must not sort or serialize all health entries while events are healthy'
)

check(
  'frontend uses a dynamic overlay and frame budget',
  app.includes('let speedResultOverlay = new Map()') &&
  (() => {
    const chunk = Number(app.match(/const speedResultChunkSize = (\d+)/)?.[1] || 0);
    const budget = Number(app.match(/const speedResultFrameBudgetMs = ([\d.]+)/)?.[1] || 0);
    return chunk > 0 && chunk <= 160 && budget > 0 && budget <= 3;
  })() &&
    app.includes('speedResultOverlay.set(name, next)') &&
    app.includes('function speedOverlayForItem') &&
    app.includes('function setSpeedProgressNotice') &&
    app.includes('setSpeedProgressNotice(delta.phase') &&
    app.includes('pendingSpeedTerminal') &&
    !between(app, 'function applySpeedStatusToNodes', 'function speedOverlayForItem').includes('updateLatestGroupItems(nextItems)'),
  'streamed delays update visible rows without cloning the complete node list'
)

check(
  'single-node speed tests use events before bounded polling fallback',
  main.includes('"kind": "started"') &&
    single.includes('"phase": "single"') &&
    app.includes('const singleSpeedWaiters = new Map()') &&
    app.includes('function rememberSpeedResultEvent') &&
    singleWait.includes('speedResultsByRun.get') &&
    singleWait.includes('pollSingleNodeDelay') &&
    interaction.includes("phase: 'single'") &&
    interaction.includes("kind: 'complete'"),
  'a fast result must release its row without repeated full-state polling'
)

check(
  'stream coalescing keeps the newest cross-phase progress',
  app.includes('let latestQueuedSpeedProgress = null') &&
    app.includes('latestQueuedSpeedProgress = payload') &&
    app.includes('const progress = latestQueuedSpeedProgress') &&
    !between(app, 'function flushSpeedResultEvents', 'function queueSpeedResultEvent').includes('progress = payload'),
  'queued refinement must not let an older fast result move progress backwards'
)

check(
  'event watchdog does not poll while queued results are draining',
  app.includes('const eventQueueDraining = pendingSpeedResults.size > 0 || pendingSpeedTerminal != null') &&
    app.includes('!eventQueueDraining && Date.now() - speedLastEventAt > 1500'),
  'a large healthy result burst must not trigger an expensive full-state fallback'
)

check(
  'speed start updates rows in place without rebuilding the node table',
  between(app, "if (kind === 'started' || kind === 'prepared')", "if (!activeSpeedRunId").includes('applySpeedStatusToNodes') &&
    !between(app, "if (kind === 'started' || kind === 'prepared')", "if (!activeSpeedRunId").includes('refreshVisibleNodesForSpeed'),
  'the pressed row button and scroll position must survive the pending transition'
)

check(
  'home summary work is limited to current-node changes and terminal reconciliation',
  app.includes('const summaryRelevant = Boolean(options.refreshSummary || (currentName && touched.has(currentName)))') &&
    app.includes('if (summaryRelevant)') &&
    app.includes('refreshSummary: true'),
  'ordinary node results must not recompute current-node stability and shell state every frame'
)

check(
  'persisted speed health uses serialized atomic replacement',
  main.includes('static SPEED_HEALTH_CACHE_LOCK: OnceLock<Mutex<()>>') &&
    main.includes('fn atomic_replace_file') &&
    main.includes('MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH') &&
    main.includes('Speed health cache lock is poisoned'),
  'repeated Windows writes and profile-switch races must not drop the cache'
)

check(
  'disconnect protection does not add a broad speed-test port window',
  main.includes('core_runtime::firewall_program_paths') &&
    !main.includes('fn build_speed_test_firewall_script') &&
    !main.includes('remoteport=$portList') &&
    !batch.includes('run_powershell') &&
    !single.includes('run_powershell'),
  'verified Aegos/core program rules are reused without widening arbitrary ports'
)

check(
  'speed runs are cancellable and stale profile writes are rejected',
  scheduler.includes('if !should_continue()') &&
    scheduler.includes('pending.clear()') &&
    batch.includes('speed_test_run_is_current') &&
    main.includes('profile switched; previous speed test cancelled') &&
    app.includes('eventRunId !== activeSpeedRunId') &&
    app.includes('profileId !== activeSpeedProfileId'),
  'subscription switch must stop dispatch and isolate every old result'
)

check(
  'speed tests remain measurement only',
  !batch.includes('change_proxy') &&
    !batch.includes('select_best_proxy') &&
    !single.includes('change_proxy') &&
    !single.includes('select_best_proxy') &&
    interaction.includes('batch speed test triggered a proxy switch'),
  'speed testing must never connect or select a node'
)

check(
  'performance and scheduler regression coverage is executable',
  scheduler.includes('fixed_workers_process_every_target') &&
    scheduler.includes('family_limit_is_enforced') &&
    scheduler.includes('cancellation_stops_new_dispatches') &&
    perf.includes('speed events blocked rendering') &&
    perf.includes('streamedBatchSize'),
  'fixed pool, cancellation, and 8000-result rendering stay behind tests'
)

const failed = checks.filter((item) => !item.ok)
console.log(JSON.stringify({
  ok: failed.length === 0,
  failed,
  passed: checks.filter((item) => item.ok),
  generatedAt: new Date().toISOString()
}, null, 2))
process.exit(failed.length ? 2 : 0)
