import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromeCandidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.CHROME_PATH
].filter(Boolean);
const chromePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
if (!chromePath) throw new Error('Chrome not found.');
if (typeof WebSocket === 'undefined') throw new Error('This Node.js runtime does not expose global WebSocket.');

const port = 9400 + Math.floor(Math.random() * 400);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegos-interaction-smoke-'));
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
        const state = {
          running: false,
          mode: 'rule',
          activeProfileId: 'url-test',
          systemProxy: false,
          tunEnabled: false
        };
        const profiles = [
          { id: 'direct', name: 'Direct', profile_type: 'builtin', updated_at: '0' },
          { id: 'url-test', name: 'Example Sub', profile_type: 'url', source_url: 'https://example.com/sub', updated_at: '1' }
        ];
        const groups = [{
          name: 'GLOBAL',
          type: 'Selector',
          now: 'HK 01',
          items: [
            { name: 'HK 01', server: 'hk.example', type: 'tuic', alive: true, delay: 33 },
            { name: 'HK 02', server: 'hk2.example', type: 'trojan', alive: true, delay: 42 },
            { name: 'JP 01', server: 'jp.example', type: 'trojan', alive: true, delay: 55 },
            { name: 'SG 01', server: 'sg.example', type: 'ss', alive: true, delay: 66 },
            { name: 'US 01', server: 'us.example', type: 'vless', alive: true, delay: 120 }
          ]
        }];
        const status = () => ({
          product: 'Aegos',
          appVersion: '0.5.5',
          running: state.running,
          controller: state.running,
          mode: state.mode,
          traffic: { up: 128, down: 256 },
          logs: [],
          activeProfile: profiles.find((item) => item.id === state.activeProfileId),
          network: { lanIp: '192.168.1.2', proxyEndpoint: '127.0.0.1:7890', outboundIp: '-' },
          protection: { label: state.running ? 'Core running' : 'Idle' },
          settings: {
            activeProfileId: state.activeProfileId,
            profiles,
            mixedPort: 7890,
            controllerPort: 19090,
            systemProxy: state.systemProxy,
            tunEnabled: state.tunEnabled,
            startWithSystemProxy: true,
            dnsHijackEnabled: true,
            killSwitchEnabled: false,
            ipv6Enabled: false,
            allowLan: false,
            tunStack: 'mixed',
            logLevel: 'info'
          }
        });
        window.__aegosCalls = calls;
        window.__TAURI__ = { core: { invoke: async (command, args = {}) => {
          calls.push({ command, args });
          if (command === 'app_status') return status();
          if (command === 'start_core') { state.running = true; return { ok: true }; }
          if (command === 'stop_core') { state.running = false; return { ok: true }; }
          if (command === 'restart_core') { state.running = true; return { ok: true }; }
          if (command === 'proxy_groups' || command === 'test_proxy_delays') return groups;
          if (command === 'set_mode') { state.mode = args.mode; return args.mode; }
          if (command === 'change_proxy') { groups[0].now = args.proxy; return true; }
          if (command === 'set_system_proxy') { state.systemProxy = args.enable; return true; }
          if (command === 'update_setting') { if (args.key === 'tunEnabled') state.tunEnabled = args.value; return status().settings; }
          if (command === 'update_profile') return profiles.find((item) => item.id === args.id);
          if (command === 'set_active_profile') { state.activeProfileId = args.id; return profiles.find((item) => item.id === args.id); }
          if (command === 'add_profile_url') return profiles[1];
          if (command === 'connections') return [{ id: '1', metadata: { host: 'example.com' }, rule: 'MATCH', chains: ['GLOBAL', 'HK 01'], upload: 1, download: 2 }];
          if (command === 'close_connection' || command === 'close_connections' || command === 'clear_logs') return true;
          if (command === 'diagnostics') return { checks: [{ name: 'core', ok: true, detail: 'mock' }] };
          if (command.startsWith('window_')) return true;
          return true;
        } } };
      })();
    `
  });
  await page.send('Page.navigate', { url: appUrl });
  await delay(1200);
  const report = await evaluate(page, `(async () => {
    const click = async (selector) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error('missing selector ' + selector);
      el.click();
      await new Promise((resolve) => setTimeout(resolve, 180));
    };
    await click('#connectBtn');
    await click('#quickUpdateSubBtn');
    await click('#quickTestBtn');
    await click('#quickProxyBtn');
    await click('#quickTunBtn');
    await click('[data-region="HK"]');
    const hkRows = [...document.querySelectorAll('#homeNodeRows .row[data-node]')].map((row) => row.dataset.node);
    if (!hkRows.length || hkRows.some((name) => !name.includes('HK'))) throw new Error('home region filter did not stay on home page');
    await click('[data-region="HK"]');
    await click('#quickModeBtn');
    await click('[data-mode-option="global"]');
    await click('[data-page="nodes"]');
    await click('[data-node-filter="low"]');
    if (!document.querySelector('[data-node-filter="low"]').classList.contains('active')) throw new Error('node filter tab did not become active');
    await click('#batchTestBtn');
    document.querySelector('#nodeSearch').value = 'HK';
    document.querySelector('#nodeSearch').dispatchEvent(new Event('input', { bubbles: true }));
    await click('#nodeRows .row[data-node]');
    await click('[data-page="connections"]');
    await click('#refreshConnectionsBtn');
    await click('#closeAllConnectionsBtn');
    await click('[data-page="profiles"]');
    await click('[data-profile-row="direct"]');
    await click('[data-profile-update="url-test"]');
    await click('[data-page="diagnostics"]');
    await click('#runDiagBtn');
    await click('[data-page="settings"]');
    await click('#restartCoreBtn');
    const commands = window.__aegosCalls.map((item) => item.command);
    const required = ['start_core', 'update_profile', 'test_proxy_delays', 'set_system_proxy', 'update_setting', 'change_proxy', 'connections', 'close_connections', 'set_active_profile', 'diagnostics', 'restart_core'];
    return {
      commands,
      missing: required.filter((name) => !commands.includes(name)),
      notice: document.querySelector('#protectionNotice')?.textContent || ''
    };
  })()`);
  const ok = report.missing.length === 0;
  console.log(JSON.stringify({ ok, ...report }, null, 2));
  if (!ok) process.exitCode = 2;
} finally {
  try { page?.close(); } catch {}
  chrome.kill();
  await delay(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); } catch {}
}
