import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const explicitExe = process.argv.find((item) => item.startsWith('--exe='))?.slice('--exe='.length);
const hiddenExe = process.argv.find((item) => item.startsWith('--hidden-exe='))?.slice('--hidden-exe='.length);
const automaticSpeedMode = process.argv.find((item) => item.startsWith('--automatic-speed='))?.slice('--automatic-speed='.length) || 'enabled';
const allowVisible = process.argv.includes('--allow-visible');
const nativeConfig = path.join(root, 'src-tauri', 'tauri.native-perf.conf.json');
const nativeTargetDir = path.join(root, 'src-tauri', 'target', 'wm04-native');
const tauriCli = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

if (process.platform !== 'win32') throw new Error('Native WebView2 performance smoke is Windows-only.');
if (explicitExe && hiddenExe) throw new Error('Use either --exe or --hidden-exe, not both.');
if (explicitExe && !allowVisible) {
  throw new Error('Refusing a potentially visible executable. Use the default hidden build or pass --allow-visible explicitly.');
}
if (allowVisible && !explicitExe) {
  throw new Error('--allow-visible requires an explicit --exe path.');
}
if (!['enabled', 'suppressed'].includes(automaticSpeedMode)) {
  throw new Error('--automatic-speed must be enabled or suppressed.');
}

function buildHiddenMeasurementExecutable() {
  if (!fs.existsSync(nativeConfig)) throw new Error(`Native measurement config not found: ${nativeConfig}`);
  if (!fs.existsSync(tauriCli)) throw new Error(`Local Tauri CLI not found: ${tauriCli}`);
  const result = spawnSync(process.execPath, [
    tauriCli,
    'build',
    '--debug',
    '--no-bundle',
    '--config',
    nativeConfig,
    '--features',
    'native-measurement'
  ], {
    cwd: root,
    env: {
      ...process.env,
      CARGO_TARGET_DIR: nativeTargetDir,
      TAURI_SKIP_UPDATE_CHECK: 'true'
    },
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Hidden native measurement build failed with exit code ${result.status ?? 'unknown'}.`);
  return path.join(nativeTargetDir, 'debug', 'aegos.exe');
}

const exe = allowVisible
  ? path.resolve(root, explicitExe)
  : hiddenExe
    ? path.resolve(root, hiddenExe)
    : buildHiddenMeasurementExecutable();

if (!fs.existsSync(exe)) throw new Error(`Native Aegos executable not found: ${exe}`);
if (typeof WebSocket === 'undefined') throw new Error('This Node.js runtime does not expose global WebSocket.');

const port = 10100 + Math.floor(Math.random() * 500);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aegos-native-perf-'));
const roaming = path.join(scratch, 'Roaming');
const local = path.join(scratch, 'Local');
const webviewData = path.join(scratch, 'WebView2');
[roaming, local, webviewData].forEach((folder) => fs.mkdirSync(folder, { recursive: true }));

function measurementStorageEvidence() {
  const settingsPath = path.join(roaming, 'settings.json');
  const profileDir = path.join(roaming, 'profiles');
  if (!fs.existsSync(settingsPath)) {
    throw new Error('Native measurement did not create settings.json in its temporary Aegos data root.');
  }
  if (!fs.existsSync(profileDir)) {
    throw new Error('Native measurement did not create profiles in its temporary Aegos data root.');
  }
  const profileFiles = fs.readdirSync(profileDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'));
  if (!profileFiles.some((entry) => entry.name === 'direct.yaml')) {
    throw new Error('Native measurement did not create the built-in profile in its temporary Aegos data root.');
  }
  return {
    settingsPresent: true,
    profileCount: profileFiles.length
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function terminateMeasurementProcessTree(child) {
  if (!child?.pid || process.platform !== 'win32') return;
  try {
    // The hidden Aegos probe can start its bundled Mihomo child. Target only
    // the PID created above so cleanup cannot affect another proxy client.
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    });
  } catch {}
}

function terminateMeasurementWebViewProcesses(rootPath) {
  if (process.platform !== 'win32') return;
  const escapedPath = rootPath.replaceAll("'", "''");
  const script = [
    `$measurementRoot = '${escapedPath}'`,
    'Get-CimInstance Win32_Process |',
    'Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like (\'*\' + $measurementRoot + \'*\') } |',
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'
  ].join(' ');
  try {
    // WebView2 can outlive its Tauri parent on Windows; match only this
    // measurement root and never a general browser process.
    const encodedScript = Buffer.from(script, 'utf16le').toString('base64');
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedScript], {
      windowsHide: true,
      stdio: 'ignore'
    });
  } catch {}
}

async function removeMeasurementScratch(rootPath) {
  let lastError = null;
  // WebView2 may release its user-data directory several seconds after the
  // embedding process exits. Keep cleanup bounded, but wait long enough to
  // make a lingering temporary root a real test failure.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      fs.rmSync(rootPath, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
      if (!fs.existsSync(rootPath)) return true;
    } catch (error) {
      lastError = error;
    }
    await wait(500);
  }
  console.error(`Native measurement temporary root was not removed: ${lastError?.message || rootPath}`);
  return false;
}

function httpJson(route) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: route }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
  });
}

async function waitForTarget() {
  let lastError = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const targets = await httpJson('/json/list');
      const page = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page) return page;
    } catch (error) {
      lastError = error;
    }
    await wait(100);
  }
  throw new Error(`WebView2 remote debugging endpoint did not start on ${port}: ${lastError?.message || 'unknown error'}`);
}

function createCdpClient(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve({
      send(method, params = {}) {
        nextId += 1;
        socket.send(JSON.stringify({ id: nextId, method, params }));
        return new Promise((requestResolve, requestReject) => {
          pending.set(nextId, { resolve: requestResolve, reject: requestReject });
        });
      },
      async close() {
        if (socket.readyState === WebSocket.CLOSED) return;
        await new Promise((resolve) => {
          const timeout = setTimeout(resolve, 1_000);
          socket.addEventListener('close', () => {
            clearTimeout(timeout);
            resolve();
          }, { once: true });
          socket.close();
        });
      }
    }), { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'WebView2 evaluation failed');
  return result.result.value;
}

async function evaluateWhenStable(cdp, expression) {
  let lastError = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await evaluate(cdp, expression);
    } catch (error) {
      lastError = error;
      if (!/Execution context was destroyed|Cannot find context/i.test(error.message || '')) throw error;
      await wait(100);
    }
  }
  throw lastError || new Error('WebView2 execution context did not stabilize.');
}

function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
}

function navigationDurations(trace = []) {
  const pending = new Map();
  const durations = [];
  trace.forEach((entry) => {
    const page = entry.targetPage || '';
    if (!page) return;
    if (entry.kind === 'navigation-request') {
      const queue = pending.get(page) || [];
      queue.push(entry.at);
      pending.set(page, queue);
      return;
    }
    if (entry.kind === 'navigation-painted') {
      const queue = pending.get(page) || [];
      const startedAt = queue.shift();
      if (Number.isFinite(startedAt)) durations.push(Math.max(0, entry.at - startedAt));
    }
  });
  return durations;
}

let app = null;
let cdp = null;
let appExit = null;
const appOutput = [];
const reportSuffix = `auto-speed-${automaticSpeedMode}`;
const failureReportPath = path.join(nativeTargetDir, `PERFORMANCE_NATIVE_${pkg.version}.${reportSuffix}.failure.json`);
function rememberAppOutput(stream, chunk) {
  appOutput.push({ stream, text: String(chunk) });
  let total = appOutput.reduce((size, entry) => size + entry.text.length, 0);
  while (total > 8000 && appOutput.length) total -= appOutput.shift().text.length;
}
try {
  app = spawn(exe, [], {
    cwd: path.dirname(exe),
    windowsHide: true,
    env: {
      ...process.env,
      APPDATA: roaming,
      LOCALAPPDATA: local,
      TEMP: local,
      TMP: local,
      AEGOS_NATIVE_PERF_DATA_ROOT: roaming,
      WEBVIEW2_USER_DATA_FOLDER: webviewData,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  app.stdout?.on('data', (chunk) => rememberAppOutput('stdout', chunk));
  app.stderr?.on('data', (chunk) => rememberAppOutput('stderr', chunk));
  app.once('exit', (code, signal) => {
    appExit = { code, signal };
  });

  const target = await waitForTarget();
  cdp = await createCdpClient(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await wait(350);
  const readiness = await evaluateWhenStable(cdp, `new Promise((resolve) => {
    const startedAt = performance.now();
    const poll = () => {
      const hasSnapshot = typeof window.__aegosPerformanceSnapshot === 'function';
      const hasHome = Boolean(document.querySelector('[data-page="home"]'));
      if (hasSnapshot && hasHome) return resolve({ ready: true, hasSnapshot, hasHome });
      if (performance.now() - startedAt > 8000) {
        return resolve({
          ready: false,
          hasSnapshot,
          hasHome,
          documentState: document.readyState,
          bodyPreview: (document.body?.innerText || '').slice(0, 240)
        });
      }
      setTimeout(poll, 40);
    };
    poll();
  })`);
  if (!readiness?.ready) {
    throw new Error(`Aegos UI did not become ready for native measurement: ${JSON.stringify(readiness)}`);
  }
  if (automaticSpeedMode === 'suppressed') {
    await evaluateWhenStable(cdp, 'window.__AEGOS_NATIVE_PERF_SUPPRESS_AUTO_SPEED__ = true');
  }
  const storage = measurementStorageEvidence();
  const nativeWindowVisible = await evaluateWhenStable(cdp, `window.__TAURI__?.window?.getCurrentWindow?.().isVisible?.()`);

  const startup = await evaluateWhenStable(cdp, `(async () => {
    const startedAt = performance.now();
    const required = new Set(['app_status', 'proxy_groups']);
    const read = () => window.__aegosPerformanceSnapshot?.() || { recentInvokes: [], pendingInvokes: [] };
    while (performance.now() - startedAt < 5000) {
      const snapshot = read();
      const finished = new Set(snapshot.recentInvokes
        .filter((item) => required.has(item.command) && item.state !== 'pending')
        .map((item) => item.command));
      if (finished.size === required.size) return { settled: true, waitedMs: performance.now() - startedAt, snapshot };
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    return { settled: false, waitedMs: performance.now() - startedAt, snapshot: read() };
  })()`);
  const startupRuntime = await evaluateWhenStable(cdp, `window.__TAURI__?.core?.invoke('core_runtime_info')`);
  await wait(500);

  const probe = await evaluateWhenStable(cdp, `(async () => {
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now())));
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitForTrace = async (kind, page, startedAt, timeout = 1500) => {
      const deadline = performance.now() + timeout;
      while (performance.now() < deadline) {
        const entry = (window.__aegosPerformanceSnapshot?.().trace || [])
          .find((item) => item.kind === kind && item.targetPage === page && item.at >= startedAt);
        if (entry) return entry.at;
        await wait(25);
      }
      return null;
    };
    const before = window.__aegosPerformanceSnapshot();
    const startedAt = performance.now();
    const pages = ['nodes', 'routing', 'settings', 'home'];
    const directNavigation = [];
    for (const page of pages) {
      const button = document.querySelector('[data-page="' + page + '"]');
      const navigationStartedAt = performance.now();
      if (typeof window.setPage === 'function') window.setPage(page);
      else if (button) {
        button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
        button.click();
      }
      const navigationReturnedAt = performance.now();
      const firstFrameAt = await nextFrame();
      directNavigation.push({
        targetPage: page,
        duration: Math.max(0, firstFrameAt - navigationStartedAt),
        synchronousMs: Math.max(0, navigationReturnedAt - navigationStartedAt),
        active: document.querySelector('.nav button.active')?.dataset.page || ''
      });
      await nextFrame();
      if (page === 'routing') {
        const contentAt = await waitForTrace('page-content-ready', 'routing', navigationStartedAt);
        directNavigation[directNavigation.length - 1].contentDuration = contentAt == null ? null : Math.max(0, contentAt - navigationStartedAt);
      } else {
        await wait(60);
      }
    }
    await nextFrame();
    const after = window.__aegosPerformanceSnapshot();
    return {
      startedAt,
      beforeTraceLength: before.trace.length,
      canDirectNavigate: typeof window.setPage === 'function',
      activePage: document.querySelector('.nav button.active')?.dataset.page || '',
      directNavigation,
      snapshot: after
    };
  })()`);

  const interactionProbe = await evaluateWhenStable(cdp, `(async () => {
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now())));
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const navigate = async (page) => {
      const startedAt = performance.now();
      window.setPage?.(page);
      const firstFrameAt = await nextFrame();
      return { startedAt, firstFrameMs: Math.max(0, firstFrameAt - startedAt) };
    };
    const recentInvokes = () => window.__aegosPerformanceSnapshot?.().recentInvokes || [];

    const settings = await navigate('settings');
    await wait(80);
    const scroller = document.querySelector('.settings-layout');
    const environmentCallsBefore = recentInvokes().filter((item) => item.command === 'environment_readiness').length;
    const scrollFrames = [];
    if (scroller) {
      const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const positions = maxScroll > 0
        ? [0, maxScroll * .2, maxScroll * .5, maxScroll * .8, maxScroll, maxScroll * .45, 0]
        : [0];
      let previousAt = performance.now();
      for (const position of positions) {
        scroller.scrollTop = Math.round(position);
        scroller.dispatchEvent(new Event('scroll'));
        const frameAt = await nextFrame();
        scrollFrames.push(Math.max(0, frameAt - previousAt));
        previousAt = frameAt;
      }
    }
    const environmentCallsAfter = recentInvokes().filter((item) => item.command === 'environment_readiness').length;
    const settingsInteraction = {
      firstFrameMs: settings.firstFrameMs,
      hasScroller: Boolean(scroller),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      rect: scroller ? (() => {
        const rect = scroller.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      })() : null,
      scrollHeight: Number(scroller?.scrollHeight || 0),
      clientHeight: Number(scroller?.clientHeight || 0),
      scrollFrameMaxMs: Math.max(0, ...scrollFrames),
      scrollFrameSamples: scrollFrames,
      environmentCallsDuringEntry: Math.max(0, environmentCallsAfter - environmentCallsBefore)
    };

    const diagnostics = await navigate('diagnostics');
    await wait(80);
    const diagnosticSwitches = [];
    for (const view of ['logs', 'overview', 'logs', 'overview']) {
      const startedAt = performance.now();
      window.setDiagnosticView?.(view);
      const returnedAt = performance.now();
      const frameAt = await nextFrame();
      const settledFrameAt = await nextFrame();
      const switchLongTasks = (window.__aegosPerformanceSnapshot?.().longTasks || [])
        .filter((entry) => Number(entry.at || 0) >= startedAt && Number(entry.at || 0) <= settledFrameAt)
        .map((entry) => Number(entry.duration || 0));
      diagnosticSwitches.push({
        view,
        synchronousMs: Math.max(0, returnedAt - startedAt),
        firstFrameMs: Math.max(0, frameAt - startedAt),
        settledFrameMs: Math.max(0, settledFrameAt - startedAt),
        longTaskMaxMs: Math.max(0, ...switchLongTasks),
        active: document.querySelector('[data-diagnostic-view-panel].active')?.dataset.diagnosticViewPanel || '',
        renderedLogRows: document.querySelectorAll('#logRows .log-row').length
      });
    }
    const navigationAway = await navigate('home');
    return {
      settings: {
        ...settingsInteraction
      },
      diagnostics: {
        firstFrameMs: diagnostics.firstFrameMs,
        switches: diagnosticSwitches,
        maxSwitchFrameMs: Math.max(0, ...diagnosticSwitches.map((item) => item.firstFrameMs)),
        maxSwitchSynchronousMs: Math.max(0, ...diagnosticSwitches.map((item) => item.synchronousMs)),
        maxSwitchLongTaskMs: Math.max(0, ...diagnosticSwitches.map((item) => item.longTaskMaxMs)),
        allSwitchesApplied: diagnosticSwitches.every((item) => item.active === item.view)
      },
      navigationAway
    };
  })()`);
  const jobProbe = await evaluateWhenStable(cdp, `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now())));
    if (typeof window.runBackgroundJob !== 'function') return { available: false };

    const cancelledWork = window.runBackgroundJob('nativeMeasurementDelay', { delayMs: 900, outcome: 'success' });
    await wait(100);
    const pendingRow = document.querySelector('#jobRows .job-row.running');
    const cancelButton = document.querySelector('#jobRows [data-job-cancel]');
    const navigationStartedAt = performance.now();
    window.setPage?.('diagnostics');
    const navigationFrameAt = await nextFrame();
    const activeWhilePending = document.querySelector('.nav button.active')?.dataset.page || '';
    cancelButton?.click();
    await cancelledWork;
    await wait(80);
    const cancelledTerminal = Boolean(document.querySelector('#jobRows .job-row.cancelled'));

    const failedWork = window.runBackgroundJob('nativeMeasurementDelay', { delayMs: 250, outcome: 'failure' });
    await failedWork;
    await wait(80);
    const failedTerminal = Boolean(document.querySelector('#jobRows .job-row.failed'));

    const completedAwayWork = window.runBackgroundJob('nativeMeasurementDelay', { delayMs: 600, outcome: 'success' });
    await wait(100);
    window.setPage?.('home');
    await nextFrame();
    const activeAfterLeaving = document.querySelector('.nav button.active')?.dataset.page || '';
    await completedAwayWork;
    await wait(80);
    const completedAwayTerminal = Boolean(document.querySelector('#jobRows .job-row.succeeded'));
    return {
      available: true,
      pendingVisible: Boolean(pendingRow),
      cancelControlVisible: Boolean(cancelButton),
      activeWhilePending,
      navigationWhilePendingMs: Math.max(0, navigationFrameAt - navigationStartedAt),
      cancelledTerminal,
      failedTerminal,
      activeAfterLeaving,
      completedAwayTerminal
    };
  })()`);
  const largeListProbe = await evaluateWhenStable(cdp, `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now())));
    const newline = String.fromCharCode(10);
    const total = 800;
    const automaticSpeedMode = ${JSON.stringify(automaticSpeedMode)};
    if (typeof window.runBackgroundJob !== 'function') return { imported: false, total };
    const standby = await window.runBackgroundJob('nativeMeasurementStandby', {}, { pollMs: 80 });
    await window.refreshStatus?.(true);
    const standbyStatus = await window.__TAURI__?.core?.invoke('app_status');
    const standbyCoreReady = Boolean(standbyStatus?.coreReady);
    if (!standby || !standbyCoreReady) return { imported: false, total, standbyCoreReady };
    const names = Array.from({ length: total }, (_, index) => 'Native Fixture ' + (index + 1));
    const proxies = names.map((name) => [
      '  - name: ' + name,
      '    type: ss',
      '    server: example.com',
      '    port: 443',
      '    cipher: aes-128-gcm',
      '    password: fixture-password'
    ].join(newline)).join(newline);
    const members = names.map((name) => '      - ' + name).join(newline);
    const rules = names.map((_, index) => '  - DOMAIN-SUFFIX,native-fixture-' + index + '.example,Fixture').join(newline);
    const content = [
      'proxies:', proxies,
      'proxy-groups:',
      '  - name: Fixture',
      '    type: select',
      '    proxies:', members,
      'rules:', rules,
      '  - MATCH,Fixture'
    ].join(newline);
    const imported = await window.runBackgroundJob('importProfileFile', {
      name: 'Native large-list fixture',
      content
    }, { pollMs: 80 });
    if (!imported?.profile?.id) return { imported: false, total };
    await window.refreshStatus?.(true);
    await window.refreshNodes?.(true, { delay: 0 });

    const waitForTrace = async (kind, startedAt, predicate) => {
      const deadline = performance.now() + 2500;
      while (performance.now() < deadline) {
        const trace = window.__aegosPerformanceSnapshot?.().trace || [];
        const entry = trace.find((item) => item.kind === kind && item.at >= startedAt && predicate(item));
        if (entry) return entry;
        await wait(25);
      }
      return null;
    };
    const observeSpeed = async () => {
      const startedAt = performance.now();
      let status = await window.__TAURI__?.core?.invoke('speed_test_status');
      const deadline = startedAt + (automaticSpeedMode === 'enabled' ? 5000 : 1200);
      while (performance.now() < deadline && Boolean(status?.running) !== (automaticSpeedMode === 'enabled')) {
        await wait(60);
        status = await window.__TAURI__?.core?.invoke('speed_test_status');
      }
      return {
        mode: automaticSpeedMode,
        observedRunning: Boolean(status?.running),
        runId: Number(status?.runId || 0),
        phase: status?.phase || '',
        observationMs: Math.max(0, performance.now() - startedAt)
      };
    };
    const automaticSpeed = await observeSpeed();
    const nodeStartedAt = performance.now();
    window.setPage?.('nodes');
    const nodeFirstFrameAt = await nextFrame();
    const nodeRender = await waitForTrace('node-rows-rendered', nodeStartedAt, (entry) => Number(entry.itemCount || 0) >= total);
    const visibleNodeRows = document.querySelectorAll('#nodeRows .row[data-node]').length;
    const routingStartedAt = performance.now();
    window.setPage?.('routing');
    const routingFirstFrameAt = await nextFrame();
    const routingContent = await waitForTrace('page-content-ready', routingStartedAt, (entry) => entry.targetPage === 'routing');
    const measureInvoke = async (command, args = {}) => {
      const startedAt = performance.now();
      const value = await window.__TAURI__?.core?.invoke(command, args);
      return { value, durationMs: Math.max(0, performance.now() - startedAt) };
    };
    const routing = await measureInvoke('routing_snapshot');
    const routingPage = await measureInvoke('routing_rule_page', {
      profileId: imported.profile.id,
      offset: 0,
      limit: 100
    });
    const routingGroupsRendered = document.querySelectorAll('#routingGroupRows > *').length;
    let cancellation = { attempted: false, acknowledgedMs: 0, terminal: !automaticSpeed.observedRunning, terminalMs: 0, phase: automaticSpeed.phase };
    if (automaticSpeed.observedRunning) {
      const cancelStartedAt = performance.now();
      await window.__TAURI__?.core?.invoke('cancel_proxy_delay_test');
      const acknowledgedMs = Math.max(0, performance.now() - cancelStartedAt);
      const deadline = performance.now() + 3000;
      let status = null;
      do {
        status = await window.__TAURI__?.core?.invoke('speed_test_status');
        if (!status?.running) break;
        await wait(40);
      } while (performance.now() < deadline);
      cancellation = {
        attempted: true,
        acknowledgedMs,
        terminal: !status?.running,
        terminalMs: Math.max(0, performance.now() - cancelStartedAt),
        phase: status?.phase || ''
      };
    }
    const traceAfter = window.__aegosPerformanceSnapshot?.() || { trace: [], recentInvokes: [] };
    const speedInvokes = (traceAfter.recentInvokes || [])
      .filter((entry) => ['start_proxy_delay_test', 'speed_test_status', 'speed_test_progress', 'cancel_proxy_delay_test'].includes(entry.command))
      .map((entry) => ({ command: entry.command, duration: Number(entry.duration || 0), state: entry.state || '' }));
    return {
      imported: true,
      total,
      standbyCoreReady,
      nodeItemCount: Number(nodeRender?.itemCount || 0),
      nodeRenderedCount: Number(nodeRender?.renderedCount || 0),
      nodeRenderMs: Number(nodeRender?.duration || 0),
      visibleNodeRows,
      nodeFirstFrameMs: Math.max(0, nodeFirstFrameAt - nodeStartedAt),
      routingFirstFrameMs: Math.max(0, routingFirstFrameAt - routingStartedAt),
      routingContentMs: routingContent == null ? null : Math.max(0, routingContent.at - routingStartedAt),
      routingSnapshotMs: routing.durationMs,
      routingRulePageMs: routingPage.durationMs,
      routingGroupsRendered,
      routingRuleCount: Number(routing.value?.summary?.ruleCount || 0),
      routingPageTotal: Number(routingPage.value?.total || 0),
      routingPageItems: Array.isArray(routingPage.value?.items) ? routingPage.value.items.length : 0,
      automaticSpeed,
      cancellation,
      speedInvokes
    };
  })()`);
  const routingObservation = await evaluateWhenStable(cdp, `window.__TAURI__?.core?.invoke('routing_snapshot')`);

  const finalSnapshot = await evaluateWhenStable(cdp, `window.__aegosPerformanceSnapshot?.() || { trace: [], longTasks: [], pendingInvokes: [] }`);
  const initialTrace = probe.snapshot?.trace || [];
  const trace = [...initialTrace, ...(finalSnapshot?.trace || [])];
  const traceKinds = trace.reduce((counts, entry) => {
    counts[entry.kind] = (counts[entry.kind] || 0) + 1;
    return counts;
  }, {});
  const paintedDurations = navigationDurations(initialTrace);
  const directDurations = (probe.directNavigation || []).map((entry) => Number(entry.duration || 0));
  const synchronousNavigationDurations = (probe.directNavigation || []).map((entry) => Number(entry.synchronousMs || 0));
  const durations = paintedDurations.length ? paintedDurations : directDurations;
  const nodeRenders = trace.filter((entry) => entry.kind === 'node-rows-rendered').map((entry) => Number(entry.duration || 0));
  const longTasks = (finalSnapshot?.longTasks || probe.snapshot?.longTasks || []).filter((entry) => entry.at >= probe.startedAt);
  const report = {
    ok: false,
    version: pkg.version,
    fixture: 'native-webview2-isolated-profile',
    automaticSpeedMode,
    hiddenWindow: {
      requested: !allowVisible,
      visible: nativeWindowVisible === true
    },
    storage,
    generatedAt: new Date().toISOString(),
    probe: {
      canDirectNavigate: probe.canDirectNavigate,
      activePage: probe.activePage,
      directNavigation: probe.directNavigation || [],
      traceKinds,
      traceTail: trace.slice(-16)
    },
    navigation: {
      count: durations.length,
      source: paintedDurations.length ? 'application-paint-trace' : 'native-first-frame',
      p95Ms: percentile(durations, 0.95),
      maxMs: Math.max(0, ...durations),
      samples: durations,
      synchronousP95Ms: percentile(synchronousNavigationDurations, 0.95),
      synchronousMaxMs: Math.max(0, ...synchronousNavigationDurations),
      synchronousSamples: synchronousNavigationDurations
    },
    routing: {
      firstContentMs: Number((probe.directNavigation || []).find((item) => item.targetPage === 'routing')?.contentDuration || 0),
      backendObservationMs: routingObservation?.runtimeObservationMs || null,
      ruleCount: Number(routingObservation?.summary?.ruleCount || 0),
      groupCount: Number(routingObservation?.summary?.groupCount || 0)
    },
    startup: {
      settled: Boolean(startup.settled),
      waitedMs: Number(startup.waitedMs || 0),
      statusMs: Number((startup.snapshot?.recentInvokes || []).find((item) => item.command === 'app_status')?.duration || 0),
      proxyGroupsMs: Number((startup.snapshot?.recentInvokes || []).find((item) => item.command === 'proxy_groups')?.duration || 0),
      pendingInvokes: startup.snapshot?.pendingInvokes || [],
      trace: (startup.snapshot?.trace || []).slice(-20),
      runtimeStartupTimingsMs: startupRuntime?.startupTimingsMs || [],
      statusCommandMs: await evaluateWhenStable(cdp, `window.__aegosLastRuntimeStatusObservation || null`)
    },
    nodeRendering: {
      count: nodeRenders.length,
      p95Ms: percentile(nodeRenders, 0.95),
      maxMs: Math.max(0, ...nodeRenders)
    },
    interaction: interactionProbe,
    jobs: jobProbe,
    largeList: largeListProbe,
    longTasks,
    pendingInvokes: finalSnapshot?.pendingInvokes || probe.snapshot?.pendingInvokes || [],
    warnings: [],
    failures: []
  };
  if (report.navigation.count < 4) report.failures.push(`native navigation evidence incomplete: ${report.navigation.count} paints`);
  if (report.hiddenWindow.requested && report.hiddenWindow.visible) report.failures.push('native measurement window became visible');
  if (!report.startup.settled) report.failures.push(`native startup IPC did not settle within 5s: ${report.startup.pendingInvokes.map((entry) => entry.command).join(', ') || 'unknown'}`);
  if (report.startup.statusMs > 700) report.failures.push(`native startup status response exceeded 700ms: ${report.startup.statusMs.toFixed(1)}ms`);
  if (report.startup.proxyGroupsMs > 1200) report.failures.push(`native startup node response exceeded 1200ms: ${report.startup.proxyGroupsMs.toFixed(1)}ms`);
  if (report.navigation.synchronousP95Ms > 16 || report.navigation.synchronousMaxMs > 50) report.failures.push(`native navigation synchronous work exceeded budget: p95=${report.navigation.synchronousP95Ms.toFixed(1)}ms max=${report.navigation.synchronousMaxMs.toFixed(1)}ms`);
  if (report.navigation.p95Ms > 50 || report.navigation.maxMs > 100) report.warnings.push(`hidden WebView2 navigation paint sampling exceeded the 50ms target: p95=${report.navigation.p95Ms.toFixed(1)}ms max=${report.navigation.maxMs.toFixed(1)}ms`);
  if (report.navigation.maxMs > 120) report.failures.push(`native navigation paint exceeded the 120ms hard budget: max=${report.navigation.maxMs.toFixed(1)}ms`);
  if (!report.routing.firstContentMs || report.routing.firstContentMs > 900) report.failures.push(`native routing first content exceeded 900ms: ${report.routing.firstContentMs || 'not-ready'}ms`);
  if (report.nodeRendering.count && report.nodeRendering.maxMs > 50) report.failures.push(`native node render budget exceeded: max=${report.nodeRendering.maxMs.toFixed(1)}ms`);
  if (!report.interaction.settings.hasScroller) report.failures.push('native settings scroller was not available');
  if (report.interaction.settings.environmentCallsDuringEntry) report.failures.push('settings entry unexpectedly started an environment check');
  if (report.interaction.settings.scrollFrameMaxMs > 80) report.failures.push(`native settings scroll frame budget exceeded: max=${report.interaction.settings.scrollFrameMaxMs.toFixed(1)}ms`);
  if (!report.interaction.diagnostics.allSwitchesApplied) report.failures.push('native diagnostics/log view switch did not apply');
  if (report.interaction.diagnostics.maxSwitchSynchronousMs > 16) report.failures.push(`native diagnostics/log synchronous switch work exceeded budget: max=${report.interaction.diagnostics.maxSwitchSynchronousMs.toFixed(1)}ms`);
  if (report.interaction.diagnostics.maxSwitchLongTaskMs > 120) report.failures.push(`native diagnostics/log switch caused a long task over 120ms: max=${report.interaction.diagnostics.maxSwitchLongTaskMs.toFixed(1)}ms`);
  if (report.interaction.diagnostics.maxSwitchFrameMs > 50) report.warnings.push(`hidden WebView2 diagnostics/log paint sampling exceeded the 50ms target: max=${report.interaction.diagnostics.maxSwitchFrameMs.toFixed(1)}ms`);
  if (report.interaction.diagnostics.maxSwitchFrameMs > 120) report.failures.push(`native diagnostics/log switch paint exceeded the 120ms hard budget: max=${report.interaction.diagnostics.maxSwitchFrameMs.toFixed(1)}ms`);
  if (report.interaction.navigationAway.firstFrameMs > 50) report.failures.push(`native navigation-away budget exceeded: ${report.interaction.navigationAway.firstFrameMs.toFixed(1)}ms`);
  if (!report.jobs.available) report.failures.push('native operation-center job probe was not available');
  if (!report.jobs.pendingVisible || !report.jobs.cancelControlVisible) report.failures.push('native pending job was not visible and cancellable in the operation center');
  if (report.jobs.activeWhilePending !== 'diagnostics') report.failures.push('native navigation was blocked while a job was pending');
  if (!report.jobs.cancelledTerminal) report.failures.push('native cancelled job did not reach a visible terminal state');
  if (!report.jobs.failedTerminal) report.failures.push('native failed job did not reach a visible terminal state');
  if (report.jobs.activeAfterLeaving !== 'home' || !report.jobs.completedAwayTerminal) report.failures.push('native job completion after navigation away was not rendered as a terminal result');
  if (!report.largeList.imported) report.failures.push('native large-list fixture did not complete its isolated import transaction');
  if (report.largeList.imported && !report.largeList.standbyCoreReady) report.failures.push('native measurement did not establish its isolated standby core before the comparison');
  if (report.largeList.nodeItemCount < report.largeList.total || report.largeList.visibleNodeRows < 1) report.failures.push('native large node list did not render a visible bounded result');
  if (report.largeList.routingGroupsRendered < 1) report.failures.push('native large routing list did not render a visible group result');
  if (report.largeList.routingRuleCount < report.largeList.total || report.largeList.routingPageTotal < report.largeList.total) report.failures.push('native large routing list did not retain its rule count and page total');
  if (report.largeList.routingPageItems < 1 || report.largeList.routingPageItems > 200) report.failures.push('native large routing page did not retain bounded page results');
  if (automaticSpeedMode === 'enabled' && !report.largeList.automaticSpeed?.observedRunning) report.failures.push('native automatic-speed-enabled comparison did not observe a running automatic measurement');
  if (automaticSpeedMode === 'suppressed' && report.largeList.automaticSpeed?.observedRunning) report.failures.push('native automatic-speed-suppressed comparison still started automatic measurement');
  if (report.largeList.cancellation?.attempted && !report.largeList.cancellation?.terminal) report.failures.push('native automatic speed cancellation did not settle within 3s');
  const maxLongTaskMs = Math.max(0, ...report.longTasks.map((entry) => Number(entry.duration)));
  if (maxLongTaskMs > 100) report.warnings.push(`native UI long task exceeded the 100ms target: max=${maxLongTaskMs.toFixed(1)}ms`);
  if (maxLongTaskMs > 120) report.failures.push(`native UI long task exceeded the 120ms hard budget: max=${maxLongTaskMs.toFixed(1)}ms`);
  if (report.pendingInvokes.length) report.warnings.push(`isolated WebView2 probe did not settle IPC: ${report.pendingInvokes.map((entry) => entry.command).join(', ')}`);
  report.ok = report.failures.length === 0;
  const reportPath = report.ok
    ? path.join(root, `PERFORMANCE_NATIVE_${pkg.version}.${reportSuffix}.json`)
    : failureReportPath;
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 2;
} catch (error) {
  const message = String(error?.message || error)
    .replaceAll(root, '<project>')
    .replaceAll(os.tmpdir(), '<temp>');
  const output = appOutput.map((entry) => ({
    stream: entry.stream,
    text: entry.text.replaceAll(root, '<project>').replaceAll(os.tmpdir(), '<temp>')
  }));
  const failure = {
    ok: false,
    version: pkg.version,
    fixture: 'native-webview2-isolated-profile',
    automaticSpeedMode,
    error: message,
    appExit,
    appOutput: output
  };
  fs.mkdirSync(nativeTargetDir, { recursive: true });
  fs.writeFileSync(failureReportPath, `${JSON.stringify(failure, null, 2)}\n`);
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 2;
} finally {
  try {
    await cdp?.close();
  } catch {}
  terminateMeasurementProcessTree(app);
  await wait(200);
  terminateMeasurementWebViewProcesses(scratch);
  await wait(500);
  if (!(await removeMeasurementScratch(scratch))) process.exitCode = 2;
}

// Undici's WebSocket can retain an event-loop handle after close on Windows.
// The report and isolated process have already been finalized above.
process.exit(process.exitCode ?? 0);
