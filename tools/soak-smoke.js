import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const chromePath = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.CHROME_PATH
].filter(Boolean).find((candidate) => fs.existsSync(candidate));

if (!chromePath) throw new Error('Chrome not found.');
if (typeof WebSocket === 'undefined') throw new Error('This Node.js runtime does not expose global WebSocket.');

const port = 10200 + Math.floor(Math.random() * 400);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegos-soak-smoke-'));
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
        const jobs = new Map();
        let jobSeq = 0;
        let running = false;
        let trafficTakeover = false;
        let activeProfileId = 'url-a';
        let speedRunning = false;
        let speedPolls = 0;
        const profiles = [
          { id: 'direct', name: 'Direct', profile_type: 'builtin', updated_at: '0', node_count: 1 },
          { id: 'url-a', name: 'Airport A', profile_type: 'url', updated_at: '1', node_count: 36 },
          { id: 'url-b', name: 'Airport B', profile_type: 'url', updated_at: '1', node_count: 36 }
        ];
        const nodes = ['HK', 'JP', 'SG', 'TW', 'US', 'GB'].flatMap((region) =>
          Array.from({ length: 8 }, (_, index) => ({
            name: region + ' Soak ' + String(index + 1).padStart(2, '0'),
            server: region.toLowerCase() + '-soak-' + index + '.example',
            type: index % 3 === 0 ? 'tuic' : index % 3 === 1 ? 'hysteria2' : 'trojan',
            alive: true,
            delay: 28 + index * 9
          }))
        );
        const status = () => ({
          product: 'Aegos',
          appVersion: '${pkg.version}',
          running,
          coreReady: running,
          trafficTakeover,
          standby: false,
          controller: running,
          mode: 'rule',
          traffic: { up: speedRunning ? 1024 : 96, down: speedRunning ? 4096 : 128 },
          logs: calls.slice(-12).map((item, index) => ({ at: String(index), level: 'info', category: 'runtime', line: item.command })),
          activeProfile: profiles.find((profile) => profile.id === activeProfileId),
          network: { lanIp: '192.168.1.2', proxyEndpoint: '127.0.0.1:7891', outboundIp: trafficTakeover ? '203.0.113.9' : '-' },
          permissions: { isAdmin: true, requiresAdminFor: [] },
          protection: { label: trafficTakeover ? 'Core running' : 'Disconnected' },
          settings: {
            activeProfileId,
            profiles,
            mixedPort: 7891,
            controllerPort: 19091,
            systemProxy: true,
            tunEnabled: false,
            startWithSystemProxy: true,
            dnsHijackEnabled: true,
            killSwitchEnabled: false,
            ipv6Enabled: false,
            allowLan: false,
            tunStack: 'mixed',
            logLevel: 'info',
            reliability: { auto: true, profileFailover: true, failureThreshold: 2, maxDelayMs: 800, candidateLimit: 24 },
            proxyTakeover: { endpoint: '127.0.0.1:7891', active: trafficTakeover, standby: running && !trafficTakeover, snapshotCaptured: trafficTakeover, restoresPreviousProxy: true }
          }
        });
        const groups = () => [{ name: 'GLOBAL', now: nodes[0].name, type: 'select', items: nodes }];
        const finishJob = (kind, payload = {}) => {
          if (kind === 'startCore') { running = true; trafficTakeover = true; }
          if (kind === 'stopCore') { running = false; trafficTakeover = false; }
          if (kind === 'restartCore') { running = true; trafficTakeover = true; }
          if (kind === 'setActiveProfile') activeProfileId = payload.id || activeProfileId;
          if (kind === 'updateSetting' && payload.key === 'systemProxy') {}
          if (kind === 'refreshOutboundIp') return { ip: trafficTakeover ? '203.0.113.9' : '-' };
          if (kind === 'diagnostics') return { summary: { errors: 0, warnings: 0, failed: 0, nextActions: [] }, status: status(), checks: [{ name: 'soak', ok: true, detail: 'mock', severity: 'ok' }] };
          return { status: status(), groups: groups() };
        };
        window.__aegosCalls = calls;
        window.__TAURI__ = { core: { invoke: async (command, args = {}) => {
          calls.push({ command, args, at: performance.now() });
          if (command === 'app_status') return status();
          if (command === 'proxy_groups') return groups();
          if (command === 'connections') return trafficTakeover ? [{ id: '1', metadata: { host: 'example.com' }, rule: 'MATCH', chains: ['GLOBAL', nodes[0].name], upload: 1, download: 2 }] : [];
          if (command === 'export_logs') return { path: 'C:\\\\Users\\\\JIE\\\\AppData\\\\Roaming\\\\Aegos\\\\diagnostics\\\\soak.txt', count: calls.length };
          if (command === 'start_proxy_delay_test') { speedRunning = true; speedPolls = 0; return { running: true, total: nodes.length, completed: 0, ok: 0, failed: 0 }; }
          if (command === 'speed_test_status') {
            speedPolls += 1;
            if (speedPolls > 3) speedRunning = false;
            return { running: speedRunning, total: nodes.length, completed: speedRunning ? speedPolls * 12 : nodes.length, ok: speedRunning ? speedPolls * 11 : nodes.length, failed: 0 };
          }
          if (command === 'test_single_proxy_delay') return { name: args.name, delay: 42, alive: true };
          if (command === 'start_job') {
            const id = 'job-' + (++jobSeq);
            const result = finishJob(args.kind, args.payload || {});
            const job = { id, kind: args.kind, label: args.kind, state: 'succeeded', progress: 1, total: 1, message: 'done', result };
            jobs.set(id, job);
            return job;
          }
          if (command === 'job_status') return args.id ? jobs.get(args.id) : [...jobs.values()].slice(-8);
          if (command === 'cancel_job') return { id: args.id, state: 'cancelled', label: 'cancelled' };
          if (command.startsWith('window_')) return true;
          return true;
        } } };
      })();
    `
  });
  await page.send('Page.navigate', { url: appUrl });
  await delay(900);
  const report = await evaluate(page, `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const click = (selector) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error('missing selector ' + selector);
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
      el.click();
    };
    const failures = [];
    for (let cycle = 0; cycle < 8; cycle += 1) {
      click('#connectBtn');
      await wait(80);
      click('[data-page="nodes"]');
      click('[data-node-filter="low"]');
      document.querySelector('#nodeSearch').value = cycle % 2 ? 'JP' : 'HK';
      document.querySelector('#nodeSearch').dispatchEvent(new Event('input', { bubbles: true }));
      click('#batchTestBtn');
      await wait(160);
      click('[data-page="diagnostics"]');
      click('#runDiagBtn');
      click('[data-page="logs"]');
      click('[data-log-filter="runtime"]');
      click('[data-page="home"]');
      click('#quickProfileBtn');
      const profileSelector = cycle % 2 ? '[data-profile-switch="url-a"]' : '[data-profile-switch="url-b"]';
      document.querySelector(profileSelector)?.click();
      await wait(180);
      click('#connectBtn');
      await wait(80);
      if (!document.querySelector('[data-page-panel="home"]')?.classList.contains('active')) failures.push('home page not active after cycle ' + cycle);
      if (document.querySelector('.nav button.active')?.dataset.page !== 'home') failures.push('home nav not active after cycle ' + cycle);
      if (document.querySelector('#connectBtn')?.disabled) failures.push('connect button disabled after cycle ' + cycle);
    }
    await wait(500);
    const commands = window.__aegosCalls.map((item) => item.command);
    const jobKinds = window.__aegosCalls.filter((item) => item.command === 'start_job').map((item) => item.args.kind);
    return {
      failures,
      commandCount: commands.length,
      commands,
      jobKinds,
      finalPage: document.querySelector('.nav button.active')?.dataset.page,
      connectText: document.querySelector('#connectBtn')?.textContent.trim(),
      versionText: document.querySelector('#appVersionLabel')?.textContent.trim(),
      stuckTesting: document.body.textContent.includes('测速中'),
      profileMenuHidden: document.querySelector('#profileMenu')?.classList.contains('hidden') ?? true
    };
  })()`);

  const failures = [...report.failures];
  for (const kind of ['startCore', 'stopCore', 'setActiveProfile', 'diagnostics']) {
    if (!report.jobKinds.includes(kind)) failures.push(`missing job kind ${kind}`);
  }
  if (!report.commands.includes('start_proxy_delay_test')) failures.push('missing batch speed test command');
  if (!report.commands.includes('speed_test_status')) failures.push('missing speed polling command');
  if (!report.commands.includes('app_status')) failures.push('missing status refresh command');
  if (report.finalPage !== 'home') failures.push(`final page ${report.finalPage}, expected home`);
  if (report.stuckTesting) failures.push('UI left visible testing text after soak');
  if (!report.profileMenuHidden) failures.push('profile menu left open after soak');
  if (report.versionText !== `v${pkg.version}`) failures.push(`version label ${report.versionText}, expected v${pkg.version}`);

  const result = { ok: failures.length === 0, failures, ...report };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
} finally {
  try { page?.close(); } catch {}
  chrome.kill();
  await delay(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); } catch {}
}
