import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const explicitExe = process.argv.find((item) => item.startsWith('--exe='))?.slice('--exe='.length);
const exe = explicitExe
  ? path.resolve(root, explicitExe)
  : path.join(root, 'src-tauri', 'target', 'debug', 'aegos.exe');

if (process.platform !== 'win32') throw new Error('Native WebView2 performance smoke is Windows-only.');
if (!fs.existsSync(exe)) throw new Error(`Native Aegos executable not found: ${exe}`);
if (typeof WebSocket === 'undefined') throw new Error('This Node.js runtime does not expose global WebSocket.');

const port = 10100 + Math.floor(Math.random() * 500);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aegos-native-perf-'));
const roaming = path.join(scratch, 'Roaming');
const local = path.join(scratch, 'Local');
const webviewData = path.join(scratch, 'WebView2');
[roaming, local, webviewData].forEach((folder) => fs.mkdirSync(folder, { recursive: true }));

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      close() {
        socket.close();
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
try {
  app = spawn(exe, [], {
    cwd: path.dirname(exe),
    windowsHide: false,
    env: {
      ...process.env,
      APPDATA: roaming,
      LOCALAPPDATA: local,
      TEMP: local,
      TMP: local,
      WEBVIEW2_USER_DATA_FOLDER: webviewData,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*`
    },
    stdio: 'ignore'
  });

  const target = await waitForTarget();
  cdp = await createCdpClient(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await wait(350);
  const ready = await evaluateWhenStable(cdp, `new Promise((resolve) => {
    const startedAt = performance.now();
    const poll = () => {
      if (typeof window.__aegosPerformanceSnapshot === 'function' && document.querySelector('[data-page="home"]')) return resolve(true);
      if (performance.now() - startedAt > 8000) return resolve(false);
      setTimeout(poll, 40);
    };
    poll();
  })`);
  if (!ready) throw new Error('Aegos UI did not become ready for native measurement.');

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
      const firstFrameAt = await nextFrame();
      directNavigation.push({
        targetPage: page,
        duration: Math.max(0, firstFrameAt - navigationStartedAt),
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
      const frameAt = await nextFrame();
      diagnosticSwitches.push({
        view,
        firstFrameMs: Math.max(0, frameAt - startedAt),
        active: document.querySelector('[data-diagnostic-view-panel].active')?.dataset.diagnosticViewPanel || ''
      });
      await nextFrame();
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
        allSwitchesApplied: diagnosticSwitches.every((item) => item.active === item.view)
      },
      navigationAway
    };
  })()`);
  const routingObservation = await evaluateWhenStable(cdp, `window.__TAURI__?.core?.invoke('routing_snapshot')`);

  const trace = probe.snapshot?.trace || [];
  const traceKinds = trace.reduce((counts, entry) => {
    counts[entry.kind] = (counts[entry.kind] || 0) + 1;
    return counts;
  }, {});
  const paintedDurations = navigationDurations(trace);
  const directDurations = (probe.directNavigation || []).map((entry) => Number(entry.duration || 0));
  const durations = paintedDurations.length ? paintedDurations : directDurations;
  const nodeRenders = trace.filter((entry) => entry.kind === 'node-rows-rendered').map((entry) => Number(entry.duration || 0));
  const longTasks = (probe.snapshot?.longTasks || []).filter((entry) => entry.at >= probe.startedAt);
  const report = {
    ok: false,
    version: pkg.version,
    fixture: 'native-webview2-isolated-profile',
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
      samples: durations
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
    longTasks,
    pendingInvokes: probe.snapshot?.pendingInvokes || [],
    warnings: [],
    failures: []
  };
  if (report.navigation.count < 4) report.failures.push(`native navigation evidence incomplete: ${report.navigation.count} paints`);
  if (!report.startup.settled) report.failures.push(`native startup IPC did not settle within 5s: ${report.startup.pendingInvokes.map((entry) => entry.command).join(', ') || 'unknown'}`);
  if (report.startup.statusMs > 700) report.failures.push(`native startup status response exceeded 700ms: ${report.startup.statusMs.toFixed(1)}ms`);
  if (report.startup.proxyGroupsMs > 1200) report.failures.push(`native startup node response exceeded 1200ms: ${report.startup.proxyGroupsMs.toFixed(1)}ms`);
  if (report.navigation.p95Ms > 50 || report.navigation.maxMs > 100) report.failures.push(`native navigation paint budget exceeded: p95=${report.navigation.p95Ms.toFixed(1)}ms max=${report.navigation.maxMs.toFixed(1)}ms`);
  if (!report.routing.firstContentMs || report.routing.firstContentMs > 900) report.failures.push(`native routing first content exceeded 900ms: ${report.routing.firstContentMs || 'not-ready'}ms`);
  if (report.nodeRendering.count && report.nodeRendering.maxMs > 50) report.failures.push(`native node render budget exceeded: max=${report.nodeRendering.maxMs.toFixed(1)}ms`);
  if (!report.interaction.settings.hasScroller) report.failures.push('native settings scroller was not available');
  if (report.interaction.settings.environmentCallsDuringEntry) report.failures.push('settings entry unexpectedly started an environment check');
  if (report.interaction.settings.scrollFrameMaxMs > 80) report.failures.push(`native settings scroll frame budget exceeded: max=${report.interaction.settings.scrollFrameMaxMs.toFixed(1)}ms`);
  if (!report.interaction.diagnostics.allSwitchesApplied) report.failures.push('native diagnostics/log view switch did not apply');
  if (report.interaction.diagnostics.maxSwitchFrameMs > 50) report.failures.push(`native diagnostics/log switch budget exceeded: max=${report.interaction.diagnostics.maxSwitchFrameMs.toFixed(1)}ms`);
  if (report.interaction.navigationAway.firstFrameMs > 50) report.failures.push(`native navigation-away budget exceeded: ${report.interaction.navigationAway.firstFrameMs.toFixed(1)}ms`);
  const maxLongTaskMs = Math.max(0, ...report.longTasks.map((entry) => Number(entry.duration)));
  if (maxLongTaskMs > 100) report.warnings.push(`native UI long task exceeded the 100ms target: max=${maxLongTaskMs.toFixed(1)}ms`);
  if (maxLongTaskMs > 120) report.failures.push(`native UI long task exceeded the 120ms hard budget: max=${maxLongTaskMs.toFixed(1)}ms`);
  if (report.pendingInvokes.length) report.warnings.push(`isolated WebView2 probe did not settle IPC: ${report.pendingInvokes.map((entry) => entry.command).join(', ')}`);
  report.ok = report.failures.length === 0;
  if (report.ok) {
    fs.writeFileSync(path.join(root, `PERFORMANCE_NATIVE_${pkg.version}.json`), `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 2;
} finally {
  try {
    cdp?.close();
  } catch {}
  if (app && !app.killed) app.kill();
  await wait(300);
  try {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
  } catch {}
}
