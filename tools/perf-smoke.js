import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const chromeCandidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.CHROME_PATH
].filter(Boolean);
const chromePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
const headed = process.argv.includes('--headed');
if (!chromePath) throw new Error('Chrome not found.');
if (typeof WebSocket === 'undefined') throw new Error('This Node.js runtime does not expose global WebSocket.');

const port = 9800 + Math.floor(Math.random() * 400);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegos-perf-smoke-'));
const appUrl = pathToFileURL(path.join(root, 'src', 'index.html')).href;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpJson(route, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: route, method }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitForChrome() {
  for (let i = 0; i < 80; i += 1) {
    try { return await httpJson('/json/version'); } catch { await delay(125); }
  }
  throw new Error('Chrome DevTools endpoint did not start.');
}

function createCdpClient(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve({
      send(method, params = {}) {
        id += 1;
        socket.send(JSON.stringify({ id, method, params }));
        return new Promise((sendResolve, sendReject) => pending.set(id, { resolve: sendResolve, reject: sendReject }));
      },
      close() { socket.close(); }
    }), { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
}

async function evaluate(page, expression) {
  const result = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
  return result.result.value;
}

const chrome = spawn(chromePath, [
  ...(headed ? ['--window-size=1280,820', '--window-position=24,24'] : ['--headless=new', '--disable-gpu']),
  '--disable-extensions',
  '--enable-precise-memory-info',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  'about:blank'
], { stdio: 'ignore' });

let page;
try {
  await waitForChrome();
  const target = await httpJson(`/json/new?${encodeURIComponent(appUrl)}`, 'PUT');
  page = await createCdpClient(target.webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      (() => {
        window.__aegosStartup = {
          startedAt: performance.now(),
          statusReadyAt: null,
          homeNodesReadyAt: null,
          coldRoutingClickAt: null,
          coldRoutingReadyAt: null
        };
        const captureStartupReadiness = () => {
          if (!window.__aegosStartup.statusReadyAt && document.querySelector('#softwareState.ok')) {
            window.__aegosStartup.statusReadyAt = performance.now();
          }
          if (!window.__aegosStartup.homeNodesReadyAt && document.querySelector('#homeNodeRows .row[data-node^="HK "]')) {
            window.__aegosStartup.homeNodesReadyAt = performance.now();
          }
          if (window.__aegosStartup.statusReadyAt && window.__aegosStartup.homeNodesReadyAt) startupObserver.disconnect();
        };
        const startupObserver = new MutationObserver(captureStartupReadiness);
        startupObserver.observe(document, { childList: true, subtree: true, attributes: true });
        captureStartupReadiness();
        const captureColdRoutingReadiness = () => {
          if (window.__aegosStartup.coldRoutingReadyAt != null) return;
          const userRuleCount = document.querySelector('#routingRuleHitCount')?.textContent.trim() || '';
          if (document.querySelector('.routing-assistant') && userRuleCount === '12') {
            window.__aegosStartup.coldRoutingReadyAt = performance.now();
            coldRoutingObserver.disconnect();
          }
        };
        const coldRoutingObserver = new MutationObserver(captureColdRoutingReadiness);
        coldRoutingObserver.observe(document, { childList: true, subtree: true, characterData: true });
        document.addEventListener('DOMContentLoaded', () => {
          const openColdRouting = () => {
            if (typeof window.__aegosPerformanceSnapshot !== 'function') {
              setTimeout(openColdRouting, 8);
              return;
            }
            const button = document.querySelector('[data-page="routing"]');
            if (!button) return;
            window.__aegosStartup.coldRoutingClickAt = performance.now();
            button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
            captureColdRoutingReadiness();
          };
          setTimeout(openColdRouting, 24);
        }, { once: true });
        const nativeSetInterval = window.setInterval.bind(window);
        const nativeClearInterval = window.clearInterval.bind(window);
        const nativeSetTimeout = window.setTimeout.bind(window);
        const nativeClearTimeout = window.clearTimeout.bind(window);
        const activeIntervals = new Set();
        const activeTimeouts = new Set();
        window.setInterval = (callback, delay, ...args) => {
          const id = nativeSetInterval(callback, delay, ...args);
          activeIntervals.add(id);
          return id;
        };
        window.clearInterval = (id) => {
          activeIntervals.delete(id);
          return nativeClearInterval(id);
        };
        window.setTimeout = (callback, delay, ...args) => {
          let id = 0;
          id = nativeSetTimeout((...callbackArgs) => {
            activeTimeouts.delete(id);
            callback(...callbackArgs);
          }, delay, ...args);
          activeTimeouts.add(id);
          return id;
        };
        window.clearTimeout = (id) => {
          activeTimeouts.delete(id);
          return nativeClearTimeout(id);
        };
        window.__aegosTimerStats = () => ({ intervals: activeIntervals.size, timeouts: activeTimeouts.size });
        const calls = [];
        const profiles = [
          { id: 'direct', name: 'Direct', profile_type: 'builtin', updated_at: '0' },
          { id: 'url-test', name: 'Example Sub', profile_type: 'url', updated_at: '1' }
        ];
        const regions = ['HK', 'JP', 'SG', 'TW', 'US', 'GB'];
        const types = ['trojan', 'tuic', 'ss', 'vless'];
        let speedPolls = 0;
        let speedRunId = 0;
        let speedRunning = false;
        let speedCompleted = 0;
        let speedOk = 0;
        let speedFailed = 0;
        const speedDelays = {};
        const speedHealth = {};
        const eventListeners = new Map();
        const speedEventStats = {
          emitted: 0,
          results: 0,
          bursts: 0,
          burstDurations: [],
          startedAt: 0,
          completedAt: 0,
          completed: false
        };
        const jobs = new Map();
        let jobSeq = 0;
        const groups = [{
          name: 'GLOBAL',
          now: 'HK 001',
          items: Array.from({ length: 8000 }, (_, index) => {
            const region = regions[index % regions.length];
            const id = String(index + 1).padStart(3, '0');
            return {
              name: region + ' ' + id,
              server: region.toLowerCase() + id + '.example',
              type: types[index % types.length],
              alive: true,
              delay: index % 5 === 0 ? 132 : 28 + (index % 70)
            };
          })
        }];
        const status = () => ({
          product: 'Aegos',
          appVersion: '${pkg.version}',
          running: true,
          coreReady: true,
          trafficTakeover: true,
          standby: false,
          controller: true,
          mode: 'rule',
          traffic: { up: 0, down: 0 },
          logs: [],
          activeProfile: profiles[1],
          network: { lanIp: '192.168.1.2', proxyEndpoint: '127.0.0.1:7891', outboundIp: '-' },
          permissions: { isAdmin: false, requiresAdminFor: ['TUN', '断网保护'] },
          protection: { label: 'Core running' },
          settings: {
            activeProfileId: 'url-test',
            profiles,
            mixedPort: 7891,
            controllerPort: 19091,
            systemProxy: false,
            tunEnabled: false,
            startWithSystemProxy: true,
            dnsHijackEnabled: true,
            killSwitchEnabled: false,
            ipv6Enabled: false,
            allowLan: false,
            tunStack: 'mixed',
            logLevel: 'info',
            reliability: { auto: true, profileFailover: true, failureThreshold: 2, maxDelayMs: 800, candidateLimit: 24 },
            proxyTakeover: { endpoint: '127.0.0.1:7891', active: true, standby: false, snapshotCaptured: false, restoresPreviousProxy: true }
          }
        });
        const emitTauriEvent = (eventName, payload) => {
          const listeners = eventListeners.get(eventName) || [];
          if (eventName === 'aegos-speed-test') {
            speedEventStats.emitted += 1;
            if (payload?.kind === 'result') speedEventStats.results += 1;
            if (payload?.kind === 'complete') speedEventStats.completed = true;
          }
          listeners.forEach((listener) => listener({ event: eventName, payload }));
        };
        const speedStatus = () => ({
          runId: speedRunId,
          running: speedRunning,
          total: groups[0].items.length,
          completed: speedCompleted,
          ok: speedOk,
          failed: speedFailed,
          delays: { ...speedDelays },
          health: { ...speedHealth },
          updatedAt: Date.now()
        });
        const scheduleSpeedEvents = () => {
          const batchSize = 400;
          const emitBatch = () => {
            if (!speedRunning) return;
            const startedAt = performance.now();
            const end = Math.min(groups[0].items.length, speedCompleted + batchSize);
            for (let index = speedCompleted; index < end; index += 1) {
              const item = groups[0].items[index];
              const delay = index % 13 === 0 ? -1 : 24 + (index % 120);
              const failureReason = delay < 0 ? 'timeout' : '';
              speedDelays[item.name] = delay;
              speedHealth[item.name] = {
                name: item.name,
                status: delay > 0 ? 'available' : 'unavailable',
                confidence: 'medium',
                lastDelay: delay,
                lastFailureReason: failureReason,
                lastTestedAt: Math.floor(Date.now() / 1000)
              };
              speedCompleted += 1;
              if (delay > 0) speedOk += 1;
              else speedFailed += 1;
              emitTauriEvent('aegos-speed-test', {
                kind: 'result',
                runId: speedRunId,
                profileId: profiles[1].id,
                name: item.name,
                selectName: item.name,
                protocol: item.type,
                delay,
                failureReason,
                completed: speedCompleted,
                total: groups[0].items.length,
                ok: speedOk,
                failed: speedFailed,
                health: speedHealth[item.name]
              });
            }
            speedEventStats.bursts += 1;
            speedEventStats.burstDurations.push(performance.now() - startedAt);
            if (speedCompleted < groups[0].items.length) {
              setTimeout(emitBatch, 24);
              return;
            }
            speedRunning = false;
            emitTauriEvent('aegos-speed-test', {
              kind: 'complete',
              runId: speedRunId,
              profileId: profiles[1].id,
              status: speedStatus()
            });
            speedEventStats.completedAt = performance.now();
          };
          setTimeout(() => {
            speedEventStats.startedAt = performance.now();
            emitTauriEvent('aegos-speed-test', {
              kind: 'started',
              runId: speedRunId,
              profileId: profiles[1].id,
              status: speedStatus()
            });
            emitBatch();
          }, 4);
        };
        window.__aegosCalls = calls;
        window.__aegosSpeedEventStats = () => ({ ...speedEventStats, burstDurations: [...speedEventStats.burstDurations] });
        window.__TAURI__ = {
          event: {
            listen: async (eventName, listener) => {
              const listeners = eventListeners.get(eventName) || [];
              listeners.push(listener);
              eventListeners.set(eventName, listeners);
              return () => {
                const current = eventListeners.get(eventName) || [];
                eventListeners.set(eventName, current.filter((candidate) => candidate !== listener));
              };
            }
          },
          core: { invoke: async (command, args = {}) => {
          calls.push({ command, args, at: performance.now() });
          if (command === 'app_status') { await new Promise((resolve) => setTimeout(resolve, 90)); return status(); }
          if (command === 'proxy_groups') { await new Promise((resolve) => setTimeout(resolve, 130)); return groups; }
          if (command === 'connections') {
            await new Promise((resolve) => setTimeout(resolve, 120));
            return [{ id: '1', target: 'example.com', rule: 'MATCH', route: ['GLOBAL', 'HK 01'], upload: 1, download: 2, process: 'browser.exe', network: 'tcp', protocol: 'HTTPS' }];
          }
          if (command === 'routing_snapshot') {
            await new Promise((resolve) => setTimeout(resolve, 120));
            return {
              readOnly: true,
              mode: 'rule',
              groups: [
                { name: 'GLOBAL', type: 'select', now: 'HK 001', itemCount: groups[0].items.length, automatic: false },
                { name: 'Auto', type: 'url-test', now: 'HK 002', itemCount: 80, automatic: true }
              ],
              rules: Array.from({ length: 3000 }, (_, index) => ({
                index: index + 1,
                raw: 'DOMAIN-SUFFIX,site-' + index + '.example,GLOBAL',
                kind: 'DOMAIN-SUFFIX',
                condition: 'site-' + index + '.example',
                target: 'GLOBAL',
                source: index < 12 ? 'user' : 'config',
                enabled: true,
                status: 'active'
              })),
              recentRules: [
                { rule: 'DOMAIN-SUFFIX,example.com', route: 'GLOBAL > HK 001', count: 1, note: 'mock' }
              ],
              summary: { groupCount: 2, autoGroupCount: 1, recentRuleHits: 1, userRuleCount: 12, ruleCount: 3000 }
            };
          }
          if (command === 'routing_rule_page') {
            const offset = Math.max(0, Number(args.offset || 0));
            const limit = Math.max(1, Number(args.limit || 80));
            const configRules = Array.from({ length: 2988 }, (_, index) => ({
              index: index + 13,
              raw: 'DOMAIN-SUFFIX,site-' + (index + 12) + '.example,GLOBAL',
              kind: 'DOMAIN-SUFFIX',
              condition: 'site-' + (index + 12) + '.example',
              target: 'GLOBAL',
              source: 'config',
              enabled: true,
              status: 'active'
            }));
            return {
              profileId: 'url-test',
              offset,
              limit,
              total: configRules.length,
              items: configRules.slice(offset, offset + limit)
            };
          }
          if (command === 'diagnostics') {
            await new Promise((resolve) => setTimeout(resolve, 120));
            return { checks: [{ name: 'core', ok: true, detail: 'mock' }] };
          }
          if (command === 'start_proxy_delay_test') {
            speedPolls = 0;
            speedRunId += 1;
            speedRunning = true;
            speedCompleted = 0;
            speedOk = 0;
            speedFailed = 0;
            Object.keys(speedDelays).forEach((key) => delete speedDelays[key]);
            Object.keys(speedHealth).forEach((key) => delete speedHealth[key]);
            speedEventStats.emitted = 0;
            speedEventStats.results = 0;
            speedEventStats.bursts = 0;
            speedEventStats.burstDurations = [];
            speedEventStats.startedAt = 0;
            speedEventStats.completedAt = 0;
            speedEventStats.completed = false;
            scheduleSpeedEvents();
            return speedStatus();
          }
          if (command === 'speed_test_status') {
            speedPolls += 1;
            return speedStatus();
          }
          if (command === 'start_job') {
            const id = 'perf-job-' + (++jobSeq);
            const job = { id, kind: args.kind, label: args.kind, state: 'running', progress: 0, total: 8, polls: 0 };
            jobs.set(id, job);
            return { ...job };
          }
          if (command === 'job_status') {
            if (!args.id) return [...jobs.values()].map(({ polls, ...job }) => ({ ...job }));
            const job = jobs.get(args.id);
            if (!job) return null;
            job.polls += 1;
            job.progress = Math.min(job.total, job.polls);
            if (job.polls >= job.total) {
              job.state = 'succeeded';
              job.result = job.kind === 'diagnostics'
                ? { checks: [{ name: 'core', ok: true, detail: 'mock' }], summary: { errors: 0, warnings: 0, failed: 0, nextActions: [] }, status: status() }
                : true;
            }
            const { polls, ...result } = job;
            return { ...result };
          }
          if (command === 'cancel_job') return { id: args.id, state: 'cancelled', label: 'cancelled' };
          if (command.startsWith('window_')) return true;
          return true;
          } }
        };
      })();
    `
  });
  await page.send('Page.navigate', { url: appUrl });
  await delay(1200);
  await page.send('Performance.enable');
  const domBefore = await page.send('Memory.getDOMCounters');
  const metricsBefore = await page.send('Performance.getMetrics');
  const report = await evaluate(page, `(async () => {
    const longTasks = [];
    const frameDeltas = [];
    const layoutShifts = [];
    let previousFrameAt = 0;
    let sampleFrames = true;
    const captureFrame = (at) => {
      if (previousFrameAt) frameDeltas.push({ at, delta: at - previousFrameAt });
      previousFrameAt = at;
      if (sampleFrames) requestAnimationFrame(captureFrame);
    };
    requestAnimationFrame(captureFrame);
    try {
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => longTasks.push({ duration: entry.duration, startTime: entry.startTime }));
      });
      observer.observe({ type: 'longtask' });
    } catch {}
    try {
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => layoutShifts.push({
          value: entry.value,
          hadRecentInput: entry.hadRecentInput,
          startTime: entry.startTime,
          sources: (entry.sources || []).map((source) => {
            const node = source.node;
            if (!node) return 'unknown';
            if (node.id) return '#' + node.id;
            const classes = typeof node.className === 'string' ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
            return node.tagName.toLowerCase() + (classes.length ? '.' + classes.join('.') : '');
          })
        }));
      });
      observer.observe({ type: 'layout-shift', buffered: true });
    } catch {}
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame((at) => resolve(at)));
    const waitFor = async (predicate, timeout = 2400) => {
      const started = performance.now();
      while (!predicate()) {
        if (performance.now() - started > timeout) return false;
        await wait(8);
      }
      return true;
    };
    const navPages = ['home', 'nodes', 'connections', 'routing', 'profiles', 'diagnostics', 'settings'];
    const navDurations = [];
    const activeFailures = [];
    const phases = [{ name: 'start', at: performance.now() }];
    const commandCount = (name) => window.__aegosCalls.filter((item) => item.command === name).length;
    const nonSpeedCallCount = () => window.__aegosCalls.filter((item) => !['start_proxy_delay_test', 'speed_test_status', 'proxy_groups'].includes(item.command)).length;
    const startupStatusCall = window.__aegosCalls.find((item) => item.command === 'app_status');
    const startupNodesCall = window.__aegosCalls.find((item) => item.command === 'proxy_groups');
    const startupRoutingCall = window.__aegosCalls.find((item) => item.command === 'routing_snapshot');
    const startupStartedAt = window.__aegosStartup.startedAt;
    const startup = {
      statusContentMs: window.__aegosStartup.statusReadyAt == null ? null : window.__aegosStartup.statusReadyAt - startupStartedAt,
      homeNodesContentMs: window.__aegosStartup.homeNodesReadyAt == null ? null : window.__aegosStartup.homeNodesReadyAt - startupStartedAt,
      backendDispatchGapMs: Math.abs((startupNodesCall?.at || 0) - (startupStatusCall?.at || 0)),
      routingDispatchMs: startupRoutingCall == null ? null : startupRoutingCall.at - startupStartedAt,
      routingAfterStatusMs: startupRoutingCall == null || window.__aegosStartup.statusReadyAt == null
        ? null
        : startupRoutingCall.at - window.__aegosStartup.statusReadyAt,
      coldRoutingContentMs: window.__aegosStartup.coldRoutingReadyAt == null || window.__aegosStartup.coldRoutingClickAt == null
        ? null
        : Math.max(0, window.__aegosStartup.coldRoutingReadyAt - window.__aegosStartup.coldRoutingClickAt)
    };
    const connectionsInitialCount = commandCount('connections');
    const connectionsClickAt = performance.now();
    document.querySelector('[data-page="connections"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    const connectionsDispatched = await waitFor(() => commandCount('connections') > connectionsInitialCount);
    const connectionsCall = [...window.__aegosCalls].reverse().find((item) => item.command === 'connections');
    const connectionsDispatchMs = connectionsDispatched && connectionsCall ? connectionsCall.at - connectionsClickAt : Infinity;
    const connectionsContentReady = await waitFor(() => document.querySelectorAll('#connectionRows .simple-row').length > 0);
    const connectionsContentMs = connectionsContentReady ? performance.now() - connectionsClickAt : Infinity;
    const routingInitialCount = commandCount('routing_snapshot');
    const routingClickAt = performance.now();
    document.querySelector('[data-page="routing"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    const routingWasPrefetched = routingInitialCount > 0;
    const routingDispatched = routingWasPrefetched || await waitFor(() => commandCount('routing_snapshot') > routingInitialCount);
    const routingCall = [...window.__aegosCalls].reverse().find((item) => item.command === 'routing_snapshot');
    const routingDispatchMs = routingWasPrefetched ? 0 : routingDispatched && routingCall ? routingCall.at - routingClickAt : Infinity;
    const routingContentReady = await waitFor(() => {
      const userRuleCount = document.querySelector('#routingRuleHitCount')?.textContent.trim() || '';
      return Boolean(document.querySelector('.routing-assistant')) && userRuleCount === '12';
    });
    const routingContentMs = routingContentReady ? performance.now() - routingClickAt : Infinity;
    const routingHiddenRuleRows = document.querySelectorAll('#routingRuleRows .routing-rule-row').length;
    const advanced = document.querySelector('#routingAdvancedPanel');
    const advancedOpenAt = performance.now();
    if (advanced) {
      advanced.open = true;
      advanced.dispatchEvent(new Event('toggle'));
    }
    const advancedReady = await waitFor(() => document.querySelectorAll('#routingRuleRows .routing-rule-row').length > 0);
    const advancedOpenMs = advancedReady ? performance.now() - advancedOpenAt : Infinity;
    const routingVisibleAdvancedRows = document.querySelectorAll('#routingRuleRows .routing-rule-row').length;
    const routingHasLoadMore = Boolean(document.querySelector('.routing-load-more'));
    const firstAdvancedRule = document.querySelector('#routingRuleRows .routing-rule-row span:nth-child(2)')?.textContent || '';
    document.querySelector('.routing-load-more')?.click();
    await waitFor(() => {
      const value = document.querySelector('#routingRuleRows .routing-rule-row span:nth-child(2)')?.textContent || '';
      return Boolean(value && value !== firstAdvancedRule);
    }, 300);
    const routingRowsAfterNextPage = document.querySelectorAll('#routingRuleRows .routing-rule-row').length;
    const nextAdvancedRule = document.querySelector('#routingRuleRows .routing-rule-row span:nth-child(2)')?.textContent || '';
    const routingPageChanged = Boolean(firstAdvancedRule && nextAdvancedRule && firstAdvancedRule !== nextAdvancedRule);
    if (advanced) advanced.open = false;
    await wait(20);
    phases.push({ name: 'first-pages-ready', at: performance.now() });
    const connectionsBefore = commandCount('connections');
    const routingBefore = commandCount('routing_snapshot');
    const diagnosticsBefore = commandCount('diagnostics');
    document.querySelector('#batchTestBtn')?.click();
    await wait(30);
    let lastRapidPage = 'home';
    const rapidNavStartedAt = performance.now();
    for (let i = 0; i < 420; i += 1) {
      const name = navPages[i % navPages.length];
      const button = document.querySelector('[data-page="' + name + '"]');
      const start = performance.now();
      if (i % 2 === 0) {
        button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
      } else {
        button.click();
      }
      const elapsed = performance.now() - start;
      navDurations.push(elapsed);
      lastRapidPage = name;
      if (!button.classList.contains('active') || !document.querySelector('[data-page-panel="' + name + '"]')?.classList.contains('active')) {
        activeFailures.push(name);
      }
      if (i % 3 === 0) await nextFrame();
    }
    const rapidNavEndedAt = performance.now();
    const finalRapidPage = document.querySelector('.nav button.active')?.dataset.page || '';
    phases.push({ name: 'rapid-nav-complete', at: performance.now() });
    const visualNavStartedAt = performance.now();
    const visualNavTransitions = [];
    let visualFromPage = document.querySelector('.nav button.active')?.dataset.page || 'unknown';
    for (let i = 0; i < 42; i += 1) {
      const name = navPages[i % navPages.length];
      const transitionStartedAt = performance.now();
      document.querySelector('[data-page="' + name + '"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
      const transitionFrames = [];
      let previousTransitionFrame = transitionStartedAt;
      for (let frame = 0; frame < 5; frame += 1) {
        const frameAt = await nextFrame();
        transitionFrames.push(Math.max(0, frameAt - previousTransitionFrame));
        previousTransitionFrame = frameAt;
      }
      const sortedTransitionFrames = [...transitionFrames].sort((a, b) => a - b);
      visualNavTransitions.push({
        from: visualFromPage,
        to: name,
        firstFrameMs: transitionFrames[0] || 0,
        p95FrameMs: sortedTransitionFrames[Math.floor(sortedTransitionFrames.length * 0.95)] || 0,
        maxFrameMs: Math.max(0, ...transitionFrames),
        settleMs: previousTransitionFrame - transitionStartedAt,
        visibleElements: document.querySelectorAll('[data-page-panel="' + name + '"] *').length
      });
      visualFromPage = name;
    }
    const visualNavEndedAt = performance.now();
    phases.push({ name: 'visual-nav-complete', at: visualNavEndedAt });
    await wait(250);
    const connectionsBeforeQuiet = commandCount('connections');
    const routingBeforeQuiet = commandCount('routing_snapshot');
    const diagnosticsBeforeQuiet = commandCount('diagnostics');
    const connectionsAfterSettle = commandCount('connections');
    const routingAfterSettle = commandCount('routing_snapshot');
    const menuDurations = [];
    const callsBeforeMenus = nonSpeedCallCount();
    for (let i = 0; i < 80; i += 1) {
      const button = document.querySelector('#modeBtn');
      const start = performance.now();
      button.click();
      menuDurations.push(performance.now() - start);
      if (i % 5 === 0) await nextFrame();
    }
    await wait(80);
    phases.push({ name: 'menus-complete', at: performance.now() });
    const filterDurations = [];
    const callsBeforeFilters = nonSpeedCallCount();
    const filterButtons = ['[data-region="HK"]', '[data-region="JP"]', '[data-node-filter="all"]', '[data-node-filter="low"]', '[data-node-filter="asia"]'];
    document.querySelector('[data-page="nodes"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    for (let i = 0; i < 100; i += 1) {
      const target = document.querySelector(filterButtons[i % filterButtons.length]);
      const start = performance.now();
      target.click();
      filterDurations.push(performance.now() - start);
      if (i % 5 === 0) await nextFrame();
    }
    const sortButtons = ['name', 'delay', 'status'];
    for (let i = 0; i < 30; i += 1) {
      document.querySelector('[data-node-sort="' + sortButtons[i % sortButtons.length] + '"]')?.click();
      if (i % 5 === 0) await nextFrame();
    }
    const search = document.querySelector('#nodeSearch');
    for (let i = 0; i < 30; i += 1) {
      const start = performance.now();
      search.value = i % 2 === 0 ? 'HK' : 'JP';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      filterDurations.push(performance.now() - start);
      if (i % 5 === 0) await nextFrame();
    }
    await nextFrame();
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await nextFrame();
    await nextFrame();
    const nodeScroller = document.querySelector('.node-table');
    if (nodeScroller) {
      nodeScroller.scrollTop = nodeScroller.scrollHeight;
      nodeScroller.dispatchEvent(new Event('scroll'));
      await nextFrame();
      await nextFrame();
    }
    const nodeVirtualBottom = document.querySelector('#nodeRows .node-virtual-spacer-bottom');
    const allNodesReachable = Boolean(
      nodeScroller &&
      nodeScroller.scrollHeight > nodeScroller.clientHeight &&
      nodeVirtualBottom &&
      Number.parseFloat(nodeVirtualBottom.style.height || '0') === 0 &&
      document.querySelector('#nodeRows .row[data-node]')
    );
    phases.push({ name: 'filters-complete', at: performance.now() });
    const callsAfterFilters = nonSpeedCallCount();
    document.querySelector('[data-page="diagnostics"]')?.click();
    document.querySelector('#runDiagBtn')?.click();
    document.querySelector('[data-page="nodes"]')?.click();
    await wait(3400);
    phases.push({ name: 'background-jobs-complete', at: performance.now() });
    const timerStats = window.__aegosTimerStats();
    const heap = performance.memory ? {
      used: performance.memory.usedJSHeapSize,
      total: performance.memory.totalJSHeapSize
    } : null;
    const visibleRows = document.querySelectorAll('#nodeRows .row[data-node]').length;
    const homeRows = document.querySelectorAll('#homeNodeRows .row[data-node]').length;
    const allElements = document.querySelectorAll('*').length;
    const backendJobPolls = window.__aegosCalls.filter((item) => item.command === 'job_status');
    const listJobPolls = backendJobPolls.filter((item) => !item.args?.id).length;
    const speedPollCount = commandCount('speed_test_status');
    const speedEventStats = window.__aegosSpeedEventStats();
    const sortedNav = [...navDurations].sort((a, b) => a - b);
    const sortedMenu = [...menuDurations].sort((a, b) => a - b);
    const sortedFilter = [...filterDurations].sort((a, b) => a - b);
    const average = (items) => items.reduce((sum, item) => sum + item, 0) / items.length;
    sampleFrames = false;
    await nextFrame();
    const sortedFrames = frameDeltas.map((item) => item.delta).sort((a, b) => a - b);
    const rapidNavFrames = frameDeltas.filter((item) => item.at >= rapidNavStartedAt && item.at <= rapidNavEndedAt).map((item) => item.delta);
    const visualNavFrames = frameDeltas.filter((item) => item.at >= visualNavStartedAt && item.at <= visualNavEndedAt).map((item) => item.delta);
    const speedFrames = frameDeltas
      .filter((item) => item.at >= speedEventStats.startedAt && item.at <= speedEventStats.completedAt + 120)
      .map((item) => item.delta);
    const sortedVisualNavFrames = [...visualNavFrames].sort((a, b) => a - b);
    const sortedSpeedFrames = [...speedFrames].sort((a, b) => a - b);
    const unexpectedLayoutShift = layoutShifts.filter((item) => !item.hadRecentInput).reduce((sum, item) => sum + item.value, 0);
    return {
      nav: {
        count: navDurations.length,
        avgMs: average(navDurations),
        p95Ms: sortedNav[Math.floor(sortedNav.length * 0.95)],
        maxMs: Math.max(...navDurations),
        activeFailures
      },
      menu: {
        count: menuDurations.length,
        avgMs: average(menuDurations),
        p95Ms: sortedMenu[Math.floor(sortedMenu.length * 0.95)],
        maxMs: Math.max(...menuDurations)
      },
      filters: {
        count: filterDurations.length,
        avgMs: average(filterDurations),
        p95Ms: sortedFilter[Math.floor(sortedFilter.length * 0.95)],
        maxMs: Math.max(...filterDurations)
      },
      visualFluidity: {
        frameCount: frameDeltas.length,
        p95FrameMs: sortedFrames[Math.floor(sortedFrames.length * 0.95)] || 0,
        maxFrameMs: Math.max(0, ...sortedFrames),
        framesOver50Ms: frameDeltas.filter((item) => item.delta > 50).length,
        rapidNavFrameCount: rapidNavFrames.length,
        rapidNavMaxFrameMs: Math.max(0, ...rapidNavFrames),
        visualNavFrameCount: visualNavFrames.length,
        visualNavP95FrameMs: sortedVisualNavFrames[Math.floor(sortedVisualNavFrames.length * 0.95)] || 0,
        visualNavMaxFrameMs: Math.max(0, ...visualNavFrames),
        visualNavTransitions,
        unexpectedLayoutShift,
        layoutShifts
      },
      speedStream: {
        ...speedEventStats,
        durationMs: Math.max(0, speedEventStats.completedAt - speedEventStats.startedAt),
        frameCount: speedFrames.length,
        p95FrameMs: sortedSpeedFrames[Math.floor(sortedSpeedFrames.length * 0.95)] || 0,
        maxFrameMs: Math.max(0, ...speedFrames),
        maxBurstMs: Math.max(0, ...speedEventStats.burstDurations)
      },
      startup,
      calls: {
        connectionsBefore,
        routingBefore,
        diagnosticsBefore,
        connectionsBeforeQuiet,
        routingBeforeQuiet,
        diagnosticsBeforeQuiet,
        connectionsAfterSettle,
        routingAfterSettle,
        callsAddedByMenus: callsBeforeFilters - callsBeforeMenus,
        callsAddedByFilters: callsAfterFilters - callsBeforeFilters,
        speedPollCount,
        jobPollCount: backendJobPolls.length,
        listJobPollCount: listJobPolls
      },
      resources: { timerStats, heap, visibleRows, homeRows, allElements, allNodesReachable },
      pageLoad: {
        connectionsDispatchMs,
        connectionsContentMs,
        connectionsContentReady,
        routingDispatchMs,
        routingContentMs,
        routingContentReady,
        routingHiddenRuleRows,
        routingWasPrefetched,
        advancedOpenMs,
        advancedReady,
        routingVisibleAdvancedRows,
        routingHasLoadMore,
        routingRowsAfterNextPage,
        routingPageChanged
      },
      finalRapidPage,
      lastRapidPage,
      longTasks,
      phases
    };
  })()`);
  await page.send('HeapProfiler.collectGarbage');
  const domAfter = await page.send('Memory.getDOMCounters');
  const metricsAfter = await page.send('Performance.getMetrics');
  const metricMap = (result) => Object.fromEntries((result.metrics || []).map((item) => [item.name, item.value]));
  report.runtime = {
    domBefore,
    domAfter,
    metricsBefore: metricMap(metricsBefore),
    metricsAfter: metricMap(metricsAfter)
  };

  const failures = [];
  const hasFiniteMs = (value) => value != null && Number.isFinite(Number(value));
  const formatMs = (value) => hasFiniteMs(value) ? `${Number(value).toFixed(1)}ms` : 'not completed';
  if (report.nav.activeFailures.length) failures.push(`navigation active failures: ${report.nav.activeFailures.join(', ')}`);
  if (!hasFiniteMs(report.startup.statusContentMs) || report.startup.statusContentMs > 250) failures.push(`startup status content too slow: ${formatMs(report.startup.statusContentMs)}`);
  if (!hasFiniteMs(report.startup.homeNodesContentMs) || report.startup.homeNodesContentMs > 300) failures.push(`startup home nodes too slow: ${formatMs(report.startup.homeNodesContentMs)}`);
  if (!hasFiniteMs(report.startup.backendDispatchGapMs) || report.startup.backendDispatchGapMs > 30) failures.push(`startup status and nodes were dispatched serially: ${formatMs(report.startup.backendDispatchGapMs)}`);
  if (!hasFiniteMs(report.startup.routingAfterStatusMs) || report.startup.routingAfterStatusMs > 30) failures.push(`startup routing prefetch did not follow active-profile readiness: ${formatMs(report.startup.routingAfterStatusMs)}`);
  const coldRoutingContentMs = hasFiniteMs(report.startup.coldRoutingContentMs)
    ? report.startup.coldRoutingContentMs
    : report.pageLoad.routingContentMs;
  if (!hasFiniteMs(coldRoutingContentMs) || coldRoutingContentMs > 260) failures.push(`cold routing first content too slow: ${formatMs(coldRoutingContentMs)}`);
  if (report.nav.p95Ms > 4 || report.nav.maxMs > 12) failures.push(`navigation too slow: p95=${report.nav.p95Ms.toFixed(2)}ms max=${report.nav.maxMs.toFixed(2)}ms`);
  if (report.menu.p95Ms > 4 || report.menu.maxMs > 12) failures.push(`menu too slow: p95=${report.menu.p95Ms.toFixed(2)}ms max=${report.menu.maxMs.toFixed(2)}ms`);
  if (report.filters.p95Ms > 4 || report.filters.maxMs > 12) failures.push(`filters too slow: p95=${report.filters.p95Ms.toFixed(2)}ms max=${report.filters.maxMs.toFixed(2)}ms`);
  if (report.visualFluidity.maxFrameMs > 180) failures.push(`global frame stall exceeded safety ceiling: p95=${report.visualFluidity.p95FrameMs.toFixed(1)}ms max=${report.visualFluidity.maxFrameMs.toFixed(1)}ms`);
  if (report.visualFluidity.rapidNavFrameCount < 80 || report.visualFluidity.rapidNavMaxFrameMs > 180) failures.push(`rapid navigation frame pacing regressed: frames=${report.visualFluidity.rapidNavFrameCount} max=${report.visualFluidity.rapidNavMaxFrameMs.toFixed(1)}ms`);
  if (report.visualFluidity.visualNavFrameCount < 180 || report.visualFluidity.visualNavP95FrameMs > 35 || report.visualFluidity.visualNavMaxFrameMs > 100) failures.push(`realistic navigation frame pacing regressed: frames=${report.visualFluidity.visualNavFrameCount} p95=${report.visualFluidity.visualNavP95FrameMs.toFixed(1)}ms max=${report.visualFluidity.visualNavMaxFrameMs.toFixed(1)}ms`);
  if (report.visualFluidity.unexpectedLayoutShift > 0.02) failures.push(`unexpected layout shift exceeded budget: ${report.visualFluidity.unexpectedLayoutShift.toFixed(4)}`);
  if (report.calls.connectionsBeforeQuiet !== report.calls.connectionsBefore) failures.push('rapid navigation triggered connections before quiet period');
  if (report.calls.routingBeforeQuiet !== report.calls.routingBefore) failures.push('rapid navigation triggered routing before quiet period');
  if (report.calls.diagnosticsBeforeQuiet !== report.calls.diagnosticsBefore) failures.push('rapid navigation triggered diagnostics before quiet period');
  if (report.finalRapidPage !== report.lastRapidPage) failures.push(`rapid navigation settled on ${report.finalRapidPage}, expected ${report.lastRapidPage}`);
  if (report.calls.connectionsBefore < 1) failures.push('connections first visit did not load data');
  if (report.calls.routingBefore < 1) failures.push('routing first visit did not use a prefetched or foreground snapshot');
  if (report.calls.callsAddedByMenus !== 0) failures.push('menu toggles triggered backend calls');
  if (report.calls.callsAddedByFilters !== 0) failures.push('filter/search interactions triggered backend calls');
  if (!hasFiniteMs(report.pageLoad.connectionsDispatchMs) || report.pageLoad.connectionsDispatchMs > 120) failures.push(`connections first-load dispatch too slow: ${formatMs(report.pageLoad.connectionsDispatchMs)}`);
  if (!report.pageLoad.connectionsContentReady || !hasFiniteMs(report.pageLoad.connectionsContentMs) || report.pageLoad.connectionsContentMs > 400) failures.push(`connections first content too slow: ${formatMs(report.pageLoad.connectionsContentMs)}`);
  if (!hasFiniteMs(report.pageLoad.routingDispatchMs) || report.pageLoad.routingDispatchMs > 120) failures.push(`routing first-load dispatch too slow: ${formatMs(report.pageLoad.routingDispatchMs)}`);
  if (!report.pageLoad.routingContentReady || !hasFiniteMs(report.pageLoad.routingContentMs) || report.pageLoad.routingContentMs > 400) failures.push(`routing first content too slow: ${formatMs(report.pageLoad.routingContentMs)}`);
  if (report.pageLoad.routingHiddenRuleRows > 1) failures.push(`collapsed routing details rendered ${report.pageLoad.routingHiddenRuleRows} hidden rule rows`);
  if (!report.pageLoad.advancedReady || !hasFiniteMs(report.pageLoad.advancedOpenMs) || report.pageLoad.advancedOpenMs > 150) failures.push(`routing details expansion too slow: ${formatMs(report.pageLoad.advancedOpenMs)}`);
  if (report.pageLoad.routingVisibleAdvancedRows > 80 || !report.pageLoad.routingHasLoadMore) failures.push(`routing details are not paged: rows=${report.pageLoad.routingVisibleAdvancedRows} loadMore=${report.pageLoad.routingHasLoadMore}`);
  if (report.pageLoad.routingRowsAfterNextPage > 80 || !report.pageLoad.routingPageChanged) failures.push(`routing detail paging did not stay bounded: rows=${report.pageLoad.routingRowsAfterNextPage} changed=${report.pageLoad.routingPageChanged}`);
  if (report.calls.speedPollCount !== 0) failures.push(`healthy event stream fell back to full polling: polls=${report.calls.speedPollCount}`);
  if (!report.speedStream.completed || report.speedStream.results !== 8000 || report.speedStream.emitted !== 8002) {
    failures.push(`speed event stream incomplete: emitted=${report.speedStream.emitted} results=${report.speedStream.results} completed=${report.speedStream.completed}`);
  }
  if (report.speedStream.bursts !== 20 || report.speedStream.durationMs > 2000) {
    failures.push(`speed event delivery missed its bounded burst budget: bursts=${report.speedStream.bursts} duration=${report.speedStream.durationMs.toFixed(1)}ms`);
  }
  if (report.speedStream.frameCount < 12 || report.speedStream.p95FrameMs > 50.1 || report.speedStream.maxFrameMs > 100) {
    failures.push(`speed events blocked rendering: frames=${report.speedStream.frameCount} p95=${report.speedStream.p95FrameMs.toFixed(1)}ms max=${report.speedStream.maxFrameMs.toFixed(1)}ms`);
  }
  if (report.speedStream.maxBurstMs > 24) failures.push(`single speed event burst blocked the UI thread: ${report.speedStream.maxBurstMs.toFixed(1)}ms`);
  if (report.resources.visibleRows > 100 || report.resources.homeRows > 8) failures.push(`node list is not windowed: nodes=${report.resources.visibleRows} home=${report.resources.homeRows}`);
  if (!report.resources.allNodesReachable) failures.push('virtual node list does not reach the final matching node');
  if (report.runtime.domAfter.nodes > 4200) failures.push(`final DOM exceeded the bounded page budget: ${report.runtime.domAfter.nodes} nodes`);
  if (report.resources.timerStats.intervals > 7 || report.resources.timerStats.timeouts > 4) failures.push(`timer retention exceeded budget: ${JSON.stringify(report.resources.timerStats)}`);
  const severeLongTasks = report.longTasks.filter((task) => task.duration >= 180);
  const worstLongTask = report.longTasks.reduce((max, task) => Math.max(max, task.duration || 0), 0);
  if (severeLongTasks.length > 1 || worstLongTask >= 300) {
    failures.push(`long tasks exceeded budget: total=${report.longTasks.length} severe=${severeLongTasks.length} max=${worstLongTask.toFixed(0)}ms`);
  }

  const result = {
    ok: failures.length === 0,
    version: pkg.version,
    fixture: { nodeCount: 8000, streamedBatchSize: 400, compositor: headed ? 'windowed-gpu' : 'headless-software' },
    generatedAt: new Date().toISOString(),
    failures,
    longTaskBudget: { severeMs: 180, maxMs: 300, maxSevereCount: 1 },
    ...report
  };
  const evidenceFile = headed
    ? `PERFORMANCE_GPU_${pkg.version}.json`
    : `PERFORMANCE_PRESSURE_${pkg.version}.json`;
  if (result.ok) fs.writeFileSync(path.join(root, evidenceFile), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
} finally {
  try { page?.close(); } catch {}
  chrome.kill();
  await delay(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); } catch {}
}
