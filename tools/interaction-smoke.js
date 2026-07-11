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
          trafficTakeover: false,
          mode: 'rule',
          activeProfileId: 'url-test',
          systemProxy: false,
          tunEnabled: false,
          killSwitchEnabled: false,
          settings: {
            mixedPort: 7891,
            controllerPort: 19091,
            tunStack: 'mixed',
            logLevel: 'info',
            reliability: {
              auto: true,
              profileFailover: true,
              failureThreshold: 2,
              maxDelayMs: 800,
              candidateLimit: 24
            }
          }
        };
        const profiles = [
          { id: 'direct', name: 'Direct', profile_type: 'builtin', updated_at: '0' },
          { id: 'url-test', name: 'Example Sub', profile_type: 'url', source_url: 'https://example.com/sub', updated_at: '1' }
        ];
        const groups = [{
          name: 'GLOBAL',
          type: 'URLTest',
          now: 'HK 01',
          items: [
            { name: 'HK 01', server: 'hk.example', type: 'tuic', alive: true, delay: -1, healthStatus: 'unknown', healthScore: 999999 },
            { name: 'HK 02', server: 'hk2.example', type: 'trojan', alive: true, delay: -1, healthStatus: 'unknown', healthScore: 999999 },
            { name: 'JP 01', server: 'jp.example', type: 'trojan', alive: true, delay: -1, healthStatus: 'unknown', healthScore: 999999 },
            { name: 'SG 01', server: 'sg.example', type: 'ss', alive: true, delay: -1, healthStatus: 'unknown', healthScore: 999999 },
            { name: 'US 01', server: 'us.example', type: 'vless', alive: true, delay: -1, healthStatus: 'unknown', healthScore: 999999 }
          ]
        }];
        let speedTestPollsRemaining = 0;
        const applyDelayResults = () => {
          groups[0].items.forEach((item, index) => {
            item.delay = [31, 48, 116, 132, 99][index];
            item.alive = true;
            item.healthStatus = item.delay < 100 ? 'low' : 'available';
            item.healthScore = item.delay + (item.type === 'tuic' ? 18 : 0);
            item.medianDelay = item.delay;
            item.jitter = index;
            item.recommended = item.name === 'HK 02';
          });
        };
        const jobs = new Map();
        const status = () => ({
          product: 'Aegos',
          appVersion: '${pkg.version}',
          running: state.running,
          coreReady: state.running,
          trafficTakeover: state.trafficTakeover,
          standby: state.running && !state.trafficTakeover,
          controller: state.running,
          mode: state.mode,
          traffic: { up: 128, down: 256 },
          logs: [
            { at: '10:00:00', level: 'info', category: 'runtime', line: 'Aegos started' },
            { at: '10:00:01', level: 'core', category: 'core', line: 'mihomo ready' },
            { at: '10:00:02', level: 'warn', category: 'diagnostic', line: 'Diagnostic warning' },
            { at: '10:00:03', level: 'debug', category: 'debug', line: 'debug detail' }
          ],
          activeProfile: profiles.find((item) => item.id === state.activeProfileId),
          network: { lanIp: '192.168.1.2', proxyEndpoint: '127.0.0.1:' + state.settings.mixedPort, outboundIp: '-' },
          permissions: { isAdmin: true, requiresAdminFor: ['TUN', '断网保护'] },
          protection: { label: state.trafficTakeover ? 'Core running' : state.running ? 'Core standby' : 'Idle' },
          settings: {
            activeProfileId: state.activeProfileId,
            profiles,
            mixedPort: state.settings.mixedPort,
            controllerPort: state.settings.controllerPort,
            systemProxy: state.systemProxy,
            tunEnabled: state.tunEnabled,
            startWithSystemProxy: true,
            dnsHijackEnabled: true,
            killSwitchEnabled: state.killSwitchEnabled,
            ipv6Enabled: false,
            allowLan: false,
            tunStack: state.settings.tunStack,
            logLevel: state.settings.logLevel,
            reliability: state.settings.reliability,
            proxyTakeover: {
              endpoint: '127.0.0.1:' + state.settings.mixedPort,
              active: state.trafficTakeover,
              standby: state.running && !state.trafficTakeover,
              snapshotCaptured: state.systemProxy,
              restoresPreviousProxy: true
            }
          }
        });
        window.__aegosCalls = calls;
        window.__TAURI__ = { core: { invoke: async (command, args = {}) => {
          calls.push({ command, args });
          if (command === 'app_status') return status();
          if (command === 'start_core') { state.running = true; state.trafficTakeover = true; return { ok: true }; }
          if (command === 'stop_core') { state.running = false; state.trafficTakeover = false; return { ok: true }; }
          if (command === 'restart_core') { state.running = true; state.trafficTakeover = true; return { ok: true }; }
          if (command === 'proxy_groups') return groups;
          if (command === 'start_job') {
            const id = 'job-' + (jobs.size + 1);
            let result = {};
            if (args.kind === 'refreshOutboundIp') result = { ip: '203.0.113.8' };
            if (args.kind === 'startCore') { state.running = true; state.trafficTakeover = true; result = { ok: true, trafficTakeover: true }; }
            if (args.kind === 'stopCore') { state.running = false; state.trafficTakeover = false; result = { ok: true, trafficTakeover: false }; }
            if (args.kind === 'restartCore') { state.running = true; state.trafficTakeover = true; result = { ok: true, trafficTakeover: true }; }
            if (args.kind === 'setActiveProfile') {
              state.activeProfileId = args.payload?.id;
              result = { profile: profiles.find((item) => item.id === args.payload?.id) };
            }
            if (args.kind === 'renameProfile') {
              const profile = profiles.find((item) => item.id === args.payload?.id);
              if (profile) profile.name = args.payload?.name;
              result = { profile };
            }
            if (args.kind === 'removeProfile') {
              const index = profiles.findIndex((item) => item.id === args.payload?.id);
              if (index >= 0) profiles.splice(index, 1);
              if (state.activeProfileId === args.payload?.id) state.activeProfileId = profiles[0]?.id || 'direct';
              result = { removed: true, id: args.payload?.id };
            }
            if (args.kind === 'updateSettings') {
              Object.assign(state.settings, args.payload?.updates || {});
              result = { settings: status().settings };
            }
            if (args.kind === 'updateSetting') {
              if (args.payload?.key === 'systemProxy') {
                state.systemProxy = Boolean(args.payload.value);
                state.trafficTakeover = state.trafficTakeover && (state.systemProxy || state.tunEnabled);
              }
              else if (args.payload?.key === 'tunEnabled') state.tunEnabled = Boolean(args.payload.value);
              else if (args.payload?.key === 'killSwitchEnabled') state.killSwitchEnabled = Boolean(args.payload.value);
              else state.settings[args.payload?.key] = args.payload?.value;
              result = { settings: status().settings };
            }
            if (args.kind === 'setMode') { state.mode = args.payload?.mode; result = { mode: state.mode }; }
            if (args.kind === 'changeProxy') {
              groups[0].now = args.payload?.proxy;
              result = { group: args.payload?.group, proxy: args.payload?.proxy };
            }
            if (args.kind === 'selectBestProxy') {
              groups[0].now = 'HK 02';
              result = { ok: true, candidate: { group: 'GLOBAL', proxy: 'HK 02', realProxyName: 'HK 02', delay: 48, score: 48, reason: 'latency<100ms' } };
            }
            if (args.kind === 'repairSystemProxy') {
              state.running = true;
              state.trafficTakeover = true;
              state.systemProxy = true;
              result = { ok: true, endpoint: '127.0.0.1:' + state.settings.mixedPort };
            }
            if (args.kind === 'recoverNetwork') {
              state.running = true;
              state.trafficTakeover = true;
              groups[0].now = 'HK 02';
              result = { ok: true, profileChanged: false, result: { action: 'switchProxy', group: 'GLOBAL', proxy: 'HK 02', delay: 48 } };
            }
            if (args.kind === 'updateProfile') result = { profile: profiles.find((item) => item.id === args.payload?.id) };
            if (args.kind === 'updateAllProfiles') result = { updated: profiles.filter((item) => item.sourceUrl), failed: [], total: 1 };
            if (args.kind === 'addProfileUrl') result = { profile: profiles[1] };
            const job = { id, kind: args.kind, label: args.kind, state: 'succeeded', progress: 1, total: 1, message: 'done', result, error: null };
            jobs.set(id, job);
            return { ...job, state: 'running' };
          }
          if (command === 'job_status') {
            if (!args.id) return [...jobs.values()];
            return jobs.get(args.id) || { id: args.id, state: 'failed', message: 'missing mock job' };
          }
          if (command === 'cancel_job') {
            const job = jobs.get(args.id) || { id: args.id, kind: 'unknown', label: 'unknown', progress: 0, total: 1 };
            job.state = 'cancelled';
            job.message = 'cancelled';
            jobs.set(args.id, job);
            return job;
          }
          if (command === 'start_proxy_delay_test') {
            state.running = true;
            groups[0].items.forEach((item, index) => {
              item.delay = 0;
              item.alive = true;
              item.healthStatus = 'testing';
              item.healthScore = 999999;
              item.medianDelay = -1;
              item.jitter = index;
              item.recommended = false;
            });
            speedTestPollsRemaining = 2;
            return { running: true, total: groups[0].items.length, completed: 0, ok: 0, failed: 0 };
          }
          if (command === 'test_single_proxy_delay') {
            const item = groups[0].items.find((item) => item.name === args.name);
            if (item) {
              item.delay = 42;
              item.alive = true;
              item.healthStatus = 'low';
              item.healthScore = 42;
              item.medianDelay = 42;
              item.jitter = 0;
            }
            return { ok: true, proxy: args.name, realProxyName: args.name, delay: 42, healthStatus: 'low' };
          }
          if (command === 'save_manual_node') {
            const node = { ...args.node, alive: true, delay: -1, manual: true, fixed: true, static: true, source: 'manual' };
            const index = groups[0].items.findIndex((item) => item.name === (args.node?.originalName || args.node?.name));
            if (index >= 0) groups[0].items[index] = node;
            else groups[0].items.push(node);
            return { node, profileId: state.activeProfileId, settings: status().settings };
          }
          if (command === 'speed_test_status') {
            if (speedTestPollsRemaining > 0) {
              speedTestPollsRemaining -= 1;
              if (speedTestPollsRemaining > 0) return { running: true, total: groups[0].items.length, completed: 2, ok: 1, failed: 0 };
              applyDelayResults();
            }
            return { running: false, total: groups[0].items.length, completed: groups[0].items.length, ok: groups[0].items.length, failed: 0 };
          }
          if (command === 'test_proxy_delays') {
            groups[0].items.forEach((item, index) => { item.delay = [31, 48, 116, 132, 99][index]; item.alive = true; });
            return groups;
          }
          if (command === 'recover_network') {
            state.running = true;
            groups[0].now = 'HK 02';
            return { ok: true, profileChanged: false, result: { action: 'switchProxy', group: 'GLOBAL', proxy: 'HK 02', delay: 48 } };
          }
          if (command === 'set_mode') { await new Promise((resolve) => setTimeout(resolve, 350)); state.mode = args.mode; return args.mode; }
          if (command === 'change_proxy') { groups[0].now = args.proxy; return true; }
          if (command === 'refresh_outbound_ip') return '203.0.113.8';
          if (command === 'set_system_proxy') { await new Promise((resolve) => setTimeout(resolve, 350)); state.systemProxy = args.enable; return true; }
          if (command === 'update_setting') { await new Promise((resolve) => setTimeout(resolve, 350)); if (args.key === 'tunEnabled') state.tunEnabled = args.value; return status().settings; }
          if (command === 'update_settings') { Object.assign(state.settings, args.updates || {}); return status().settings; }
          if (command === 'update_profile') return profiles.find((item) => item.id === args.id);
          if (command === 'set_active_profile') { await new Promise((resolve) => setTimeout(resolve, 350)); state.activeProfileId = args.id; return profiles.find((item) => item.id === args.id); }
          if (command === 'remove_profile') { await new Promise((resolve) => setTimeout(resolve, 350)); const index = profiles.findIndex((item) => item.id === args.id); if (index >= 0) profiles.splice(index, 1); if (state.activeProfileId === args.id) state.activeProfileId = profiles[0]?.id || 'direct'; return true; }
          if (command === 'add_profile_url') return profiles[1];
          if (command === 'connections') return [{ id: '1', metadata: { host: 'example.com' }, rule: 'MATCH', chains: ['GLOBAL', 'HK 01'], upload: 1, download: 2 }];
          if (command === 'export_logs') return { path: 'C:\\Users\\JIE\\AppData\\Roaming\\Aegos\\diagnostics\\aegos-logs-smoke.txt', count: status().logs.length };
          if (command === 'close_connection' || command === 'close_connections' || command === 'clear_logs') { await new Promise((resolve) => setTimeout(resolve, 350)); return true; }
          if (command === 'diagnostics') {
            await new Promise((resolve) => setTimeout(resolve, 350));
            return {
            generatedAt: new Date().toISOString(),
            appVersion: '${pkg.version}',
            status: status(),
            summary: {
              total: 2,
              failed: 1,
              errors: 0,
              warnings: 1,
              nextActions: ['Open logs and inspect the latest core warning.']
            },
            checks: [
              { name: 'mihomo core', ok: true, detail: 'mock', severity: 'ok', category: 'runtime', hint: '' },
              { name: 'Recent core logs', ok: false, detail: '[warn] mock warning', severity: 'warning', category: 'logs', hint: 'Open logs and inspect the latest core warning.', actionable: true }
            ]
            };
          }
          if (command === 'relaunch_as_admin') return true;
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
    const navDown = async (selector) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error('missing selector ' + selector);
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    };
    await click('#connectBtn');
    if (document.querySelector('#pageTitle')) throw new Error('duplicate top-left page title still renders');
    if (document.querySelector('#connectBtn')?.textContent.trim() !== '断开连接') throw new Error('connect button did not optimistically show disconnect');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'refreshOutboundIp')) throw new Error('first connect did not auto refresh outbound IP');
    if (document.querySelector('#quickIpBtn')) throw new Error('manual outbound IP quick action still renders');
    await click('#quickKillBtn');
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (!document.querySelector('#quickKillBtn .kill-icon')) throw new Error('disconnect protection icon is not using stable css icon');
    if (!document.querySelector('#killToggle')?.checked) throw new Error('quick kill protection did not update setting');
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'updateSetting' && item.args.payload?.key === 'killSwitchEnabled')) throw new Error('quick kill protection did not call backend setting');
    await click('#quickUpdateSubBtn');
    if (!document.querySelector('[data-home-mode="region"]')?.classList.contains('active')) throw new Error('home did not default to common regions');
    if (!document.querySelector('[data-region="HK"]')?.classList.contains('active')) throw new Error('home did not default to Hong Kong region');
    if (document.querySelector('#homeRegionRow')?.classList.contains('hidden')) throw new Error('home common regions were hidden by default');
    if (document.querySelector('[data-page-jump="nodes"]')) throw new Error('all nodes shortcut still renders on home');
    const switchCallsBeforeSpeed = window.__aegosCalls.filter((item) => item.command === 'change_proxy' || (item.command === 'start_job' && item.args.kind === 'changeProxy')).length;
    await click('#quickTestBtn');
    await click('[data-home-mode="favorite"]');
    await click('[data-home-mode="region"]');
    await click('[data-region="JP"]');
    await click('[data-region="HK"]');
    await new Promise((resolve) => setTimeout(resolve, 750));
    if (document.querySelector('#homeNodeRows')?.textContent.includes('测速中')) throw new Error('home filter switch left rows stuck in testing state after speed test');
    const switchCallsAfterSpeed = window.__aegosCalls.filter((item) => item.command === 'change_proxy' || (item.command === 'start_job' && item.args.kind === 'changeProxy')).length;
    if (switchCallsAfterSpeed !== switchCallsBeforeSpeed) throw new Error('speed test triggered a proxy switch');
    if (document.querySelector('#switchRecommendedBtn') || document.querySelector('.recommend-compact')) throw new Error('recommended switch control still renders');
    if (document.querySelector('#autoGroupNotice')?.classList.contains('hidden')) throw new Error('automatic strategy group warning did not render');
    if (document.querySelector('#bestNodeList') || document.querySelector('.best-node')) throw new Error('duplicate recommended node strip still renders');
    if (!document.querySelector('#quickTestBtn')?.textContent.includes('⚡')) throw new Error('speed test quick action does not use lightning icon');
    if (!document.querySelector('#systemProxyMetric')?.classList.contains('is-danger')) throw new Error('disabled system proxy metric is not highlighted');
    if (!document.querySelector('#systemProxyMetric') || !document.querySelector('#upRate') || !document.querySelector('#downRate')) throw new Error('home runtime metrics did not show proxy and traffic state');
    if (document.querySelector('#tunMetric') || document.querySelector('#adminMetric') || document.querySelector('.traffic-card')) throw new Error('low-value home/sidebar metrics still render');
    await click('#lockAutoGroupBtn');
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'changeProxy')) throw new Error('auto group lock did not use background proxy change job');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'refreshOutboundIp')) throw new Error('node switch did not auto refresh outbound IP');
    if (!document.querySelector('#outboundMetric')?.textContent.includes('203.0.113.8')) throw new Error('auto refreshed outbound IP did not render');
    if (!document.querySelector('#homeNodeRows .row[data-node]')?.textContent.includes('ms')) throw new Error('home node delays did not update after quick speed test');
    if (!document.querySelector('.delay-good') || !document.querySelector('.delay-bad')) throw new Error('delay color classes did not render green/red states');
    if (document.querySelector('#connectBtn')?.textContent.trim() === '断开连接') {
      await click('#connectBtn');
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    if (document.querySelector('#connectBtn')?.textContent.trim() !== '连接') throw new Error('disconnect did not return connect button to idle');
    const startCoreBeforeStandbySpeed = window.__aegosCalls.filter((item) => item.command === 'start_job' && item.args.kind === 'startCore').length;
    const switchCallsBeforeStandbySpeed = window.__aegosCalls.filter((item) => item.command === 'change_proxy' || (item.command === 'start_job' && item.args.kind === 'changeProxy')).length;
    await click('#quickTestBtn');
    const startCoreAfterStandbySpeed = window.__aegosCalls.filter((item) => item.command === 'start_job' && item.args.kind === 'startCore').length;
    const switchCallsAfterStandbySpeed = window.__aegosCalls.filter((item) => item.command === 'change_proxy' || (item.command === 'start_job' && item.args.kind === 'changeProxy')).length;
    if (startCoreAfterStandbySpeed !== startCoreBeforeStandbySpeed) throw new Error('standby speed test triggered the connect job');
    if (switchCallsAfterStandbySpeed !== switchCallsBeforeStandbySpeed) throw new Error('standby speed test triggered a proxy switch');
    if (document.querySelector('#connectBtn')?.textContent.trim() !== '连接') throw new Error('standby speed test changed the connect button to disconnect');
    document.querySelector('#quickProxyBtn').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (document.querySelector('#quickProxyBtn')?.disabled) throw new Error('home proxy quick action became blocking while backend was pending');
    if (!document.querySelector('#systemProxyToggle')?.checked) throw new Error('system proxy toggle did not update optimistically');
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (document.querySelector('#connectBtn')?.textContent.trim() !== '连接') throw new Error('manual system proxy toggle auto-connected traffic takeover');
    if (!document.querySelector('#systemProxyMetric')?.textContent.includes('待连接')) throw new Error('manual system proxy preference did not show pending connection state');
    if (document.querySelector('#quickTunBtn') || document.querySelector('#quickCopyProxyBtn') || document.querySelector('#smartRecoverBtn') || document.querySelector('#quickModeBtn')) throw new Error('removed quick actions still render');
    await click('#quickProfileBtn');
    if (document.querySelector('[data-page-panel="profiles"]')?.classList.contains('active')) throw new Error('quick subscription switch navigated to profiles page');
    if (document.querySelector('#profileMenu')?.classList.contains('hidden')) throw new Error('quick subscription menu did not open');
    await click('#quickProfileBtn');
    if (!document.querySelector('#profileMenu')?.classList.contains('hidden')) throw new Error('quick subscription menu did not close on second click');
    await click('#quickProfileBtn');
    if (document.querySelector('#profileMenu')?.classList.contains('hidden')) throw new Error('quick subscription menu did not reopen on third click');
    const profileMenuBox = document.querySelector('#profileMenu')?.getBoundingClientRect();
    if (!profileMenuBox || profileMenuBox.width > 340 || profileMenuBox.height > 340 || profileMenuBox.left < 0 || profileMenuBox.right > window.innerWidth || profileMenuBox.top < 0 || profileMenuBox.bottom > window.innerHeight) throw new Error('quick subscription menu layout overflowed');
    const topElement = document.elementFromPoint(profileMenuBox.left + profileMenuBox.width / 2, profileMenuBox.top + Math.min(28, profileMenuBox.height / 2));
    if (!topElement?.closest('#profileMenu')) throw new Error('quick subscription menu was covered by another layer');
    document.querySelector('#profileMenu [data-profile-switch="url-test"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'setActiveProfile')) throw new Error('quick subscription menu did not switch through background job');
    await new Promise((resolve) => setTimeout(resolve, 420));
    const hkRows = [...document.querySelectorAll('#homeNodeRows .row[data-node]')].map((row) => row.dataset.node);
    if (!hkRows.length || hkRows.some((name) => !name.includes('HK'))) throw new Error('home region filter did not stay on home page');
    await click('[data-region="HK"]');
    await click('#modeBtn');
    document.querySelector('[data-mode-option="global"]').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (document.querySelector('#modeLabel')?.textContent.trim() !== '全局代理') throw new Error('mode label did not update optimistically');
    await new Promise((resolve) => setTimeout(resolve, 420));
    const connectionCallsBeforeNav = window.__aegosCalls.filter((item) => item.command === 'connections').length;
    const diagnosticCallsBeforeNav = window.__aegosCalls.filter((item) => item.command === 'diagnostics').length;
    await navDown('[data-page="connections"]');
    if (!document.querySelector('[data-page="connections"]')?.classList.contains('active')) throw new Error('sidebar navigation did not activate on pointerdown');
    if (!document.querySelector('[data-page-panel="connections"]')?.classList.contains('active')) throw new Error('connections page panel did not activate immediately');
    await navDown('[data-page="settings"]');
    await navDown('[data-page="diagnostics"]');
    await navDown('[data-page="profiles"]');
    await navDown('[data-page="logs"]');
    await navDown('[data-page="home"]');
    await navDown('[data-page="connections"]');
    await navDown('[data-page="settings"]');
    await new Promise((resolve) => setTimeout(resolve, 140));
    const connectionCallsAfterCancel = window.__aegosCalls.filter((item) => item.command === 'connections').length;
    const diagnosticCallsAfterCancel = window.__aegosCalls.filter((item) => item.command === 'diagnostics').length;
    if (connectionCallsAfterCancel !== connectionCallsBeforeNav) throw new Error('stale navigation data load was not cancelled after leaving the page');
    if (diagnosticCallsAfterCancel !== diagnosticCallsBeforeNav) throw new Error('rapid cached navigation triggered diagnostics before the quiet period');
    await navDown('[data-page="diagnostics"]');
    await new Promise((resolve) => setTimeout(resolve, 900));
    const diagnosticCallsAfterSettle = window.__aegosCalls.filter((item) => item.command === 'diagnostics').length;
    if (diagnosticCallsAfterSettle !== diagnosticCallsBeforeNav) throw new Error('diagnostics page navigation auto-ran heavy diagnostics');
    if (document.querySelectorAll('[data-home-mode]').length !== 4) throw new Error('home node mode buttons did not render');
    await navDown('[data-page="home"]');
    await click('[data-home-mode="region"]');
    if (document.querySelector('#homeRegionRow')?.classList.contains('hidden')) throw new Error('common region subpage buttons did not show');
    await click('[data-region="TW"]');
    await click('[data-region="HK"]');
    if (!document.querySelector('[data-region="HK"]')?.classList.contains('active')) throw new Error('home region child filter did not become active');
    await click('[data-home-mode="fixed"]');
    if (!document.querySelector('[data-home-mode="fixed"]')?.classList.contains('active')) throw new Error('fixed node mode did not become active');
    await click('#addFixedNodeBtn');
    document.querySelector('#nodeEditNameInput').value = 'Fixed Smoke 01';
    document.querySelector('#nodeEditTypeSelect').value = 'socks5';
    document.querySelector('#nodeEditServerInput').value = '198.51.100.10';
    document.querySelector('#nodeEditPortInput').value = '1080';
    await click('#saveNodeEditorBtn');
    if (!window.__aegosCalls.some((item) => item.command === 'save_manual_node')) throw new Error('fixed node editor did not save through backend command');
    if (!document.querySelector('#homeNodeRows .row[data-node="Fixed Smoke 01"]')) throw new Error('fixed node filter did not show saved manual node');
    await navDown('[data-page="nodes"]');
    await click('[data-node-filter="low"]');
    if (!document.querySelector('[data-node-filter="low"]').classList.contains('active')) throw new Error('node filter tab did not become active');
    await new Promise((resolve) => setTimeout(resolve, 420));
    const switchCallsBeforeBatchSpeed = window.__aegosCalls.filter((item) => item.command === 'change_proxy' || (item.command === 'start_job' && item.args.kind === 'changeProxy')).length;
    await click('#batchTestBtn');
    await new Promise((resolve) => setTimeout(resolve, 750));
    const switchCallsAfterBatchSpeed = window.__aegosCalls.filter((item) => item.command === 'change_proxy' || (item.command === 'start_job' && item.args.kind === 'changeProxy')).length;
    if (switchCallsAfterBatchSpeed !== switchCallsBeforeBatchSpeed) throw new Error('batch speed test triggered a proxy switch');
    if (!document.querySelector('#nodeRows .row[data-node]')?.textContent.includes('ms')) throw new Error('node page delays did not update after batch speed test');
    const lowRows = [...document.querySelectorAll('#nodeRows .row[data-node]')];
    const lowDelayValues = lowRows.map((row) => Number(row.querySelector('.delay-good')?.textContent.replace(/[^0-9]/g, '')));
    if (!lowRows.length || lowDelayValues.some((value) => !Number.isFinite(value) || value >= 100)) throw new Error('low latency filter included nodes at or above 100 ms');
    if (document.querySelector('#nodeRows .delay-bad')) throw new Error('low latency filter rendered a red high-latency node');
    document.querySelector('#nodeSearch').value = 'HK';
    document.querySelector('#nodeSearch').dispatchEvent(new Event('input', { bubbles: true }));
    const rowActionButtons = [...document.querySelectorAll('#nodeRows [data-node-action]')];
    if (rowActionButtons.length < 3) throw new Error('node row action buttons did not render');
    const rowActionBox = document.querySelector('#nodeRows .row-actions')?.getBoundingClientRect();
    const tableBox = document.querySelector('.node-table')?.getBoundingClientRect();
    if (!rowActionBox || !tableBox || rowActionBox.right > tableBox.right - 6) throw new Error('node row actions are too close to the table edge');
    if (!document.querySelector('.row-action-labels')?.textContent.includes('测速')) throw new Error('node action labels did not render');
    if (document.querySelector('#nodeRows .row[data-node]')?.children.length !== 9) throw new Error('node status column was not removed');
    await click('#nodeRows [data-node-action="edit"]');
    if (!document.querySelector('#protectionNotice')?.textContent.includes('编辑节点')) throw new Error('node edit action did not show feedback');
    await click('#nodeRows [data-node-action="test"]');
    if (!window.__aegosCalls.some((item) => item.command === 'test_single_proxy_delay')) throw new Error('single node delay action did not call backend');
    await click('#nodeRows [data-node-action="favorite"]');
    await click('[data-node-filter="favorite"]');
    if (!document.querySelector('#nodeRows .row[data-node]')) throw new Error('favorite node filter did not show favorited node');
    await click('#nodeRows .row[data-node]');
    await click('[data-page="connections"]');
    await click('#refreshConnectionsBtn');
    document.querySelector('#closeAllConnectionsBtn').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (document.querySelector('#connectionRows .simple-row')) throw new Error('connections did not clear optimistically');
    await new Promise((resolve) => setTimeout(resolve, 420));
    await click('[data-page="profiles"]');
    document.querySelector('[data-profile-row="direct"]').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (!document.querySelector('[data-profile-row="direct"]')?.classList.contains('active')) throw new Error('profile row did not become active optimistically');
    await new Promise((resolve) => setTimeout(resolve, 420));
    window.prompt = () => 'Renamed Smoke Sub';
    await click('[data-profile-rename="url-test"]');
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (!document.querySelector('[data-profile-row="url-test"]')?.textContent.includes('Renamed Smoke Sub')) throw new Error('profile rename did not update row');
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'renameProfile')) throw new Error('profile rename did not use background job');
    await click('[data-profile-update="url-test"]');
    if (!document.querySelector('[data-profile-row="url-test"]')?.classList.contains('is-pending')) throw new Error('profile update did not show row pending feedback immediately');
    if (document.querySelector('[data-profile-update="url-test"]')?.disabled) throw new Error('profile update button became disabled during pending feedback');
    await new Promise((resolve) => setTimeout(resolve, 420));
    await click('#updateAllProfilesBtn');
    if (!document.querySelector('[data-profile-row="url-test"]')?.classList.contains('is-pending')) throw new Error('update all did not mark remote profile rows pending immediately');
    if (document.querySelector('#updateAllProfilesBtn')?.disabled) throw new Error('update all button became disabled during pending feedback');
    await new Promise((resolve) => setTimeout(resolve, 420));
    document.querySelector('#profileUrlInput').value = 'https://example.com/new-sub.yaml';
    await click('#addProfileBtn');
    if (!document.querySelector('[data-profile-row^="pending-"]')?.classList.contains('is-pending')) throw new Error('profile import did not insert a pending row immediately');
    if (document.querySelector('#addProfileBtn')?.disabled) throw new Error('profile import button became disabled during pending feedback');
    await new Promise((resolve) => setTimeout(resolve, 420));
    document.querySelector('[data-profile-remove="url-test"]').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (document.querySelector('[data-profile-row="url-test"]')) throw new Error('profile row did not remove optimistically');
    await new Promise((resolve) => setTimeout(resolve, 420));
    await click('[data-page="diagnostics"]');
    await click('#runDiagBtn');
    if (!document.querySelector('#runDiagBtn')?.textContent.includes('诊断中')) throw new Error('diagnostics button did not show running feedback');
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!document.querySelector('#diagSummary .diagnostic-status')) throw new Error('diagnostic summary did not render');
    if (!document.querySelector('#diagRows .diagnostic-row.severity-warning')) throw new Error('diagnostic severity row did not render');
    if (!document.querySelector('#diagRows .diagnostic-hint')) throw new Error('diagnostic actionable hint did not render');
    await click('[data-page="logs"]');
    const callsBeforeLogFilter = window.__aegosCalls.length;
    await click('[data-log-filter="core"]');
    if (!document.querySelector('[data-log-filter="core"]')?.classList.contains('active')) throw new Error('core log filter did not activate');
    if (!document.querySelector('#logRows')?.textContent.includes('mihomo ready')) throw new Error('core log filter did not show core log');
    if (document.querySelector('#logRows')?.textContent.includes('Diagnostic warning')) throw new Error('core log filter leaked diagnostic log');
    await click('[data-log-filter="all"]');
    if (!document.querySelector('#logRows')?.textContent.includes('Diagnostic warning')) throw new Error('all log filter did not restore diagnostic log');
    if (window.__aegosCalls.length !== callsBeforeLogFilter) throw new Error('log filters triggered backend calls');
    await click('#exportLogsBtn');
    if (!window.__aegosCalls.some((item) => item.command === 'export_logs')) throw new Error('log export button did not call export_logs');
    await click('[data-page="settings"]');
    if (!document.querySelector('.settings-summary-grid')) throw new Error('settings runtime summary did not render');
    if (document.querySelectorAll('[data-page-panel="settings"] .settings-section').length < 5) throw new Error('settings grouped sections did not render');
    if (!document.querySelector('#settingsTakeoverSummary')) throw new Error('settings takeover summary did not render');
    await click('#repairProxyBtn');
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'repairSystemProxy')) throw new Error('repair proxy button did not use repairSystemProxy job');
    await click('#elevateBtn');
    document.querySelector('#mixedPortInput').value = '7891';
    document.querySelector('#controllerPortInput').value = '19091';
    document.querySelector('#tunStackSelect').value = 'gvisor';
    document.querySelector('#logLevelSelect').value = 'warning';
    await click('#savePortBtn');
    await click('#restartCoreBtn');
    await click('#connectBtn');
    const jobCenterText = document.querySelector('#jobRows')?.textContent || '';
    if (!jobCenterText.includes('startCore') && !jobCenterText.includes('restartCore') && !jobCenterText.includes('updateSettings')) throw new Error('background job center did not render recent jobs');
    const cancelJobButton = document.querySelector('#jobRows [data-job-cancel]');
    if (!cancelJobButton) throw new Error('background job center did not render cancel action');
    cancelJobButton.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const commands = window.__aegosCalls.map((item) => item.command);
    const advancedSettingsCall = window.__aegosCalls.find((item) => item.command === 'start_job' && item.args.kind === 'updateSettings');
    const required = ['start_job', 'job_status', 'cancel_job', 'start_proxy_delay_test', 'speed_test_status', 'relaunch_as_admin', 'connections', 'close_connections', 'diagnostics'];
    const jobKinds = window.__aegosCalls.filter((item) => item.command === 'start_job').map((item) => item.args.kind);
    return {
      commands,
      missing: required.filter((name) => !commands.includes(name)),
      missingJobKinds: ['startCore', 'stopCore', 'restartCore', 'setMode', 'changeProxy', 'repairSystemProxy', 'setActiveProfile', 'removeProfile', 'renameProfile', 'updateSetting', 'updateSettings', 'refreshOutboundIp', 'updateProfile', 'updateAllProfiles', 'addProfileUrl'].filter((name) => !jobKinds.includes(name)),
      advancedSettings: advancedSettingsCall?.args?.payload?.updates || null,
      jobCenterText,
      notice: document.querySelector('#protectionNotice')?.textContent || ''
    };
  })()`);
  const ok = report.missing.length === 0 && report.missingJobKinds.length === 0;
  console.log(JSON.stringify({ ok, ...report }, null, 2));
  if (!ok) process.exitCode = 2;
} finally {
  try { page?.close(); } catch {}
  chrome.kill();
  await delay(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); } catch {}
}
