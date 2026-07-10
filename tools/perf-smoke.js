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
  '--headless=new',
  '--disable-gpu',
  '--disable-extensions',
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
        const calls = [];
        const profiles = [
          { id: 'direct', name: 'Direct', profile_type: 'builtin', updated_at: '0' },
          { id: 'url-test', name: 'Example Sub', profile_type: 'url', updated_at: '1' }
        ];
        const regions = ['HK', 'JP', 'SG', 'TW', 'US', 'GB'];
        const types = ['trojan', 'tuic', 'ss', 'vless'];
        const groups = [{
          name: 'GLOBAL',
          now: 'HK 001',
          items: Array.from({ length: 600 }, (_, index) => {
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
          controller: true,
          mode: 'rule',
          traffic: { up: 0, down: 0 },
          logs: [],
          activeProfile: profiles[1],
          network: { lanIp: '192.168.1.2', proxyEndpoint: '127.0.0.1:7891', outboundIp: '-' },
          permissions: { isAdmin: false, requiresAdminFor: ['TUN', 'Kill Switch'] },
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
            reliability: { auto: true, profileFailover: true, failureThreshold: 2, maxDelayMs: 800, candidateLimit: 24 }
          }
        });
        window.__aegosCalls = calls;
        window.__TAURI__ = { core: { invoke: async (command, args = {}) => {
          calls.push({ command, args, at: performance.now() });
          if (command === 'app_status') return status();
          if (command === 'proxy_groups') return groups;
          if (command === 'connections') {
            await new Promise((resolve) => setTimeout(resolve, 120));
            return [{ id: '1', metadata: { host: 'example.com' }, rule: 'MATCH', chains: ['GLOBAL', 'HK 01'], upload: 1, download: 2 }];
          }
          if (command === 'diagnostics') {
            await new Promise((resolve) => setTimeout(resolve, 120));
            return { checks: [{ name: 'core', ok: true, detail: 'mock' }] };
          }
          if (command.startsWith('window_')) return true;
          return true;
        } } };
      })();
    `
  });
  await page.send('Page.navigate', { url: appUrl });
  await delay(1200);
  const report = await evaluate(page, `(async () => {
    const longTasks = [];
    try {
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => longTasks.push({ duration: entry.duration, startTime: entry.startTime }));
      });
      observer.observe({ type: 'longtask' });
    } catch {}
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const navPages = ['home', 'nodes', 'connections', 'profiles', 'diagnostics', 'logs', 'settings'];
    const navDurations = [];
    const activeFailures = [];
    const commandCount = (name) => window.__aegosCalls.filter((item) => item.command === name).length;
    const connectionsBefore = commandCount('connections');
    const diagnosticsBefore = commandCount('diagnostics');
    for (let i = 0; i < 140; i += 1) {
      const name = navPages[i % navPages.length];
      const button = document.querySelector('[data-page="' + name + '"]');
      const start = performance.now();
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
      const elapsed = performance.now() - start;
      navDurations.push(elapsed);
      if (!button.classList.contains('active') || !document.querySelector('[data-page-panel="' + name + '"]')?.classList.contains('active')) {
        activeFailures.push(name);
      }
      if (i % 7 === 0) await nextFrame();
    }
    await wait(250);
    const connectionsBeforeQuiet = commandCount('connections');
    const diagnosticsBeforeQuiet = commandCount('diagnostics');
    document.querySelector('[data-page="connections"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    await wait(760);
    const connectionsAfterSettle = commandCount('connections');
    const menuDurations = [];
    const callsBeforeMenus = window.__aegosCalls.length;
    for (let i = 0; i < 80; i += 1) {
      const button = document.querySelector(i % 2 === 0 ? '#modeBtn' : '#quickModeBtn');
      const start = performance.now();
      button.click();
      menuDurations.push(performance.now() - start);
      if (i % 10 === 0) await nextFrame();
    }
    await wait(80);
    const filterDurations = [];
    const callsBeforeFilters = window.__aegosCalls.length;
    const filterButtons = ['[data-region="HK"]', '[data-region="JP"]', '[data-node-filter="all"]', '[data-node-filter="low"]', '[data-node-filter="asia"]'];
    document.querySelector('[data-page="nodes"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    for (let i = 0; i < 100; i += 1) {
      const target = document.querySelector(filterButtons[i % filterButtons.length]);
      const start = performance.now();
      target.click();
      filterDurations.push(performance.now() - start);
      if (i % 10 === 0) await nextFrame();
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
    const sortedNav = [...navDurations].sort((a, b) => a - b);
    const sortedMenu = [...menuDurations].sort((a, b) => a - b);
    const sortedFilter = [...filterDurations].sort((a, b) => a - b);
    const average = (items) => items.reduce((sum, item) => sum + item, 0) / items.length;
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
      calls: {
        connectionsBefore,
        diagnosticsBefore,
        connectionsBeforeQuiet,
        diagnosticsBeforeQuiet,
        connectionsAfterSettle,
        callsAddedByMenus: callsBeforeFilters - callsBeforeMenus,
        callsAddedByFilters: window.__aegosCalls.length - callsBeforeFilters
      },
      longTasks
    };
  })()`);

  const failures = [];
  if (report.nav.activeFailures.length) failures.push(`navigation active failures: ${report.nav.activeFailures.join(', ')}`);
  if (report.nav.p95Ms > 4 || report.nav.maxMs > 12) failures.push(`navigation too slow: p95=${report.nav.p95Ms.toFixed(2)}ms max=${report.nav.maxMs.toFixed(2)}ms`);
  if (report.menu.p95Ms > 4 || report.menu.maxMs > 12) failures.push(`menu too slow: p95=${report.menu.p95Ms.toFixed(2)}ms max=${report.menu.maxMs.toFixed(2)}ms`);
  if (report.filters.p95Ms > 4 || report.filters.maxMs > 12) failures.push(`filters too slow: p95=${report.filters.p95Ms.toFixed(2)}ms max=${report.filters.maxMs.toFixed(2)}ms`);
  if (report.calls.connectionsBeforeQuiet !== report.calls.connectionsBefore) failures.push('rapid navigation triggered connections before quiet period');
  if (report.calls.diagnosticsBeforeQuiet !== report.calls.diagnosticsBefore) failures.push('rapid navigation triggered diagnostics before quiet period');
  if (report.calls.connectionsAfterSettle < report.calls.connectionsBeforeQuiet + 1) failures.push('settled connections page did not refresh after quiet period');
  if (report.calls.callsAddedByMenus !== 0) failures.push('menu toggles triggered backend calls');
  if (report.calls.callsAddedByFilters !== 0) failures.push('filter/search interactions triggered backend calls');
  const severeLongTasks = report.longTasks.filter((task) => task.duration >= 90);
  if (severeLongTasks.length || report.longTasks.length >= 4) failures.push(`long tasks detected: total=${report.longTasks.length} severe=${severeLongTasks.length}`);

  const result = { ok: failures.length === 0, failures, ...report };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
} finally {
  try { page?.close(); } catch {}
  chrome.kill();
  await delay(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); } catch {}
}
