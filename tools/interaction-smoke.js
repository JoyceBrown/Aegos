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
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.exception?.value || result.exceptionDetails.text;
    throw new Error(detail || 'Runtime evaluation failed');
  }
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
            { name: 'US 01', server: 'us.example', type: 'vless', alive: true, delay: -1, healthStatus: 'unknown', healthScore: 999999 },
            ...Array.from({ length: 84 }, (_, index) => {
              const number = String(index + 6).padStart(2, '0');
              const region = ['HK', 'JP', 'SG', 'US'][index % 4];
              return { name: region + ' ' + number, server: region.toLowerCase() + number + '.example', type: ['ss', 'tuic', 'anytls', 'vless', 'trojan'][index % 5], alive: true, delay: -1, healthStatus: 'unknown', healthScore: 999999 };
            })
          ]
        }];
        window.__aegosMockGroups = groups;
        let speedTestPollsRemaining = 0;
        let speedRunId = 42;
        const eventListeners = new Map();
        const emitEvent = (name, payload) => {
          for (const listener of eventListeners.get(name) || []) listener({ event: name, payload });
        };
        const speedStatusSnapshot = (running, completed) => {
          const delays = Object.fromEntries(groups[0].items.map((item) => [item.name, item.delay]));
          const health = Object.fromEntries(groups[0].items.map((item) => [item.name, {
            status: item.healthStatus,
            confidence: item.healthConfidence,
            last_delay: item.delay,
            median_delay: item.medianDelay,
            jitter: item.jitter,
            score: item.healthScore,
            failure_streak: item.failureStreak || 0,
            last_tested_at: item.lastTestedAt || 0
          }]));
          return {
            runId: speedRunId,
            running,
            total: groups[0].items.length,
            completed,
            ok: groups[0].items.filter((item) => item.delay > 0).length,
            failed: 0,
            updatedAt: Math.floor(Date.now() / 1000),
            delays,
            health,
            recommended: { realProxyName: 'HK 02', proxy: 'HK 02' }
          };
        };
        const applyPartialDelayResults = () => {
          const testedAt = Math.floor(Date.now() / 1000);
          groups[0].items.slice(0, 2).forEach((item, index) => {
            item.delay = [31, 48][index];
            item.alive = true;
            item.healthStatus = 'low';
            item.healthScore = item.delay;
            item.medianDelay = item.delay;
            item.jitter = index;
            item.healthConfidence = 'high';
            item.lastTestedAt = testedAt;
            item.recommended = item.name === 'HK 02';
          });
        };
        const applyDelayResults = () => {
          const testedAt = Math.floor(Date.now() / 1000);
          groups[0].items.forEach((item, index) => {
            item.delay = [31, 48, 116, 132, 99][index % 5];
            item.alive = true;
            item.healthStatus = item.delay < 100 ? 'low' : 'available';
            item.healthScore = item.delay + (item.type === 'tuic' ? 18 : 0);
            item.medianDelay = item.delay;
            item.jitter = index;
            item.healthConfidence = item.delay < 100 ? 'high' : 'medium';
            item.lastTestedAt = testedAt;
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
          permissions: { isAdmin: true, requiresAdminFor: ['TUN', '\u65ad\u7f51\u4fdd\u62a4'] },
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
        const diagnosticsResult = () => ({
          generatedAt: new Date().toISOString(),
          appVersion: '${pkg.version}',
          status: status(),
          summary: {
            total: 2,
            failed: 1,
            errors: 0,
            warnings: 1,
            nextActions: ['重启网络核心后重新检查。']
          },
          checks: [
            { name: 'mihomo core', title: '网络核心', code: 'AEG-CON-001', ok: true, detail: '网络核心文件可用。', technicalDetail: 'mock core path', severity: 'ok', category: 'connection', hint: '', repair: { available: false } },
            { name: 'Recent core logs', title: '近期网络异常', code: 'AEG-NOD-099', ok: false, detail: '近期日志中出现了需要关注的节点错误。', technicalDetail: '[warn] mock warning', severity: 'warning', category: 'node', hint: '重启网络核心后重新检查。', actionable: true, repair: { available: true, kind: 'restart-core', label: '重启网络核心' } }
          ],
          evidenceLogs: [{ at: 'now', level: 'warn', category: 'core', line: 'mock warning' }],
          groups: ['connection', 'subscription', 'node', 'dns', 'tun', 'system-proxy', 'firewall']
        });
        window.__TAURI__ = {
          event: {
            listen: async (name, listener) => {
              const listeners = eventListeners.get(name) || [];
              listeners.push(listener);
              eventListeners.set(name, listeners);
              return () => eventListeners.set(name, (eventListeners.get(name) || []).filter((item) => item !== listener));
            }
          },
          core: { invoke: async (command, args = {}) => {
          calls.push({ command, args });
          if (command === 'app_status') return status();
          if (command === 'start_core') { state.running = true; state.trafficTakeover = true; if (!state.tunEnabled) state.systemProxy = true; return { ok: true, trafficTakeover: true }; }
          if (command === 'stop_core') { state.running = false; state.trafficTakeover = false; state.systemProxy = false; return { ok: true, trafficTakeover: false }; }
          if (command === 'restart_core') { state.running = true; state.trafficTakeover = true; return { ok: true }; }
          if (command === 'proxy_groups') return groups;
          if (command === 'preview_profile_groups') return groups;
          if (command === 'start_job') {
            const id = 'job-' + (jobs.size + 1);
            let result = {};
            if (args.kind === 'refreshOutboundIp') result = { ip: '203.0.113.8' };
            if (args.kind === 'diagnostics') result = diagnosticsResult();
            if (args.kind === 'startCore') { state.running = true; state.trafficTakeover = true; if (!state.tunEnabled) state.systemProxy = true; result = { ok: true, trafficTakeover: true }; }
            if (args.kind === 'stopCore') { state.running = false; state.trafficTakeover = false; state.systemProxy = false; result = { ok: true, trafficTakeover: false }; }
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
            if (args.kind === 'repairDiagnostic') result = { ok: true, action: args.payload?.action };
            if (args.kind === 'recoverNetwork') {
              state.running = true;
              state.trafficTakeover = true;
              groups[0].now = 'HK 02';
              result = { ok: true, profileChanged: false, result: { action: 'switchProxy', group: 'GLOBAL', proxy: 'HK 02', delay: 48 } };
            }
            if (args.kind === 'updateProfile') result = { profile: profiles.find((item) => item.id === args.payload?.id) };
            if (args.kind === 'updateAllProfiles') result = { updated: profiles.filter((item) => item.sourceUrl), failed: [], total: 1 };
            if (args.kind === 'addProfileUrl') result = { profile: profiles[1] };
            if (args.kind === 'applyRoutingDrafts') result = {
              appliedCount: Array.isArray(args.payload?.drafts) ? args.payload.drafts.length : 0,
              profileName: profiles.find((item) => item.id === state.activeProfileId)?.name || 'Example Sub',
              rollbackAvailable: true,
              deploymentValidation: { controllerReady: true, runtimeIdentityOk: true, networkAvailable: true }
            };
            if (args.kind === 'undoRoutingApply') result = { undone: true, rollbackAvailable: false };
            if (args.kind === 'applyRoutingRuleEdit') result = { ok: true, action: args.payload?.action || 'add' };
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
            speedRunId = 42;
            state.running = true;
            groups[0].items.forEach((item, index) => {
              item.delay = 0;
              item.alive = true;
              item.healthStatus = 'testing';
              item.healthScore = 999999;
              item.medianDelay = -1;
              item.jitter = index;
              item.healthConfidence = 'testing';
              item.recommended = false;
            });
            speedTestPollsRemaining = 2;
            setTimeout(() => emitEvent('aegos-speed-test', {
              kind: 'started',
              profileId: state.activeProfileId,
              status: speedStatusSnapshot(true, 0)
            }), 0);
            const values = [31, 48, 116, 132, 99];
            groups[0].items.forEach((item, index) => {
              setTimeout(() => {
                const testedAt = Math.floor(Date.now() / 1000);
                item.delay = values[index % values.length];
                item.alive = true;
                item.healthStatus = item.delay < 100 ? 'low' : 'available';
                item.healthScore = item.delay + (item.type === 'tuic' ? 18 : 0);
                item.medianDelay = item.delay;
                item.jitter = index;
                item.healthConfidence = item.delay < 100 ? 'high' : 'medium';
                item.lastTestedAt = testedAt;
                item.recommended = item.name === 'HK 02';
                emitEvent('aegos-speed-test', {
                  kind: 'result',
                  runId: 42,
                  profileId: state.activeProfileId,
                  name: item.name,
                  selectName: item.name,
                  protocol: item.type,
                  delay: item.delay,
                  failureReason: '',
                  completed: index + 1,
                  total: groups[0].items.length,
                  ok: index + 1,
                  failed: 0,
                  health: speedStatusSnapshot(true, index + 1).health[item.name]
                });
              }, 20 + index * 2);
            });
            setTimeout(() => emitEvent('aegos-speed-test', {
              kind: 'complete',
              profileId: state.activeProfileId,
              status: speedStatusSnapshot(false, groups[0].items.length)
            }), 40 + groups[0].items.length * 2);
            return speedStatusSnapshot(true, 0);
          }
          if (command === 'test_single_proxy_delay') {
            speedRunId = 77;
            speedTestPollsRemaining = 2;
            setTimeout(() => emitEvent('aegos-speed-test', {
              kind: 'started',
              runId: 77,
              profileId: state.activeProfileId,
              status: speedStatusSnapshot(true, 0)
            }), 0);
            const item = groups[0].items.find((item) => item.name === args.name);
            if (item) {
              item.delay = 0;
              item.alive = true;
              item.healthStatus = 'testing';
              item.healthScore = 999999;
              item.medianDelay = -1;
              item.jitter = 0;
              item.healthConfidence = 'testing';
              setTimeout(() => {
                item.delay = 42;
                item.alive = true;
                item.healthStatus = 'low';
                item.healthScore = 42;
                item.medianDelay = 42;
                item.healthConfidence = 'high';
                item.lastTestedAt = Math.floor(Date.now() / 1000);
                const health = speedStatusSnapshot(false, 1).health[item.name];
                emitEvent('aegos-speed-test', {
                  kind: 'result',
                  phase: 'single',
                  runId: 77,
                  profileId: state.activeProfileId,
                  name: item.name,
                  selectName: item.name,
                  protocol: item.type,
                  delay: 42,
                  failureReason: '',
                  completed: 1,
                  total: 1,
                  ok: 1,
                  failed: 0,
                  health
                });
                emitEvent('aegos-speed-test', {
                  kind: 'complete',
                  runId: 77,
                  profileId: state.activeProfileId,
                  status: speedStatusSnapshot(false, 1)
                });
              }, 180);
            }
            return { ok: true, queued: true, runId: 77, proxy: args.name, realProxyName: args.name, delay: 0, healthStatus: 'testing' };
          }
          if (command === 'node_diagnostics') {
            return {
              node: { group: 'GLOBAL', proxy: args.name, realProxyName: args.name, protocol: 'trojan', region: 'HK' },
              health: { status: 'low', confidence: 'high', lastDelay: 42 },
              logs: [],
              lastFailure: null,
              suggestions: [],
              generatedAt: 1
            };
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
              if (speedTestPollsRemaining > 0) {
                applyPartialDelayResults();
                return speedStatusSnapshot(true, 2);
              }
              applyDelayResults();
            }
            return speedStatusSnapshot(false, groups[0].items.length);
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
          if (command === 'preview_profile_groups') return groups;
          if (command === 'profile_removal_impact') return { profileId: args.id, profileName: profiles.find((item) => item.id === args.id)?.name || 'Test', affectedRuleCount: 0, rulesWillBeRetained: true };
          if (command === 'remove_profile') { await new Promise((resolve) => setTimeout(resolve, 350)); const index = profiles.findIndex((item) => item.id === args.id); if (index >= 0) profiles.splice(index, 1); if (state.activeProfileId === args.id) state.activeProfileId = profiles[0]?.id || 'direct'; return true; }
          if (command === 'add_profile_url') return profiles[1];
          if (command === 'routing_snapshot') {
            await new Promise((resolve) => setTimeout(resolve, 240));
            return {
              readOnly: true,
              mode: state.mode,
              groups: [
                { name: 'GLOBAL', type: 'select', now: groups[0].now, itemCount: groups[0].items.length, automatic: false },
                { name: 'Auto', type: 'url-test', now: 'HK 02', itemCount: 2, automatic: true }
              ],
              recentRules: [
                { rule: 'DOMAIN-SUFFIX,example.com', route: 'GLOBAL > HK 01', count: 1, note: 'mock hit' }
              ],
              rules: [
                { index: 1, kind: 'DOMAIN-SUFFIX', condition: state.activeProfileId + '.example.com', target: 'GLOBAL', status: 'readonly', note: 'profile rule', options: [] },
                { index: 2, kind: 'DOMAIN', condition: 'api.ipify.org', target: 'Aegos Landing IP', status: 'readonly', note: 'system rule', options: [] }
              ],
              summary: { groupCount: 2, autoGroupCount: 1, recentRuleHits: 1, ruleCount: 2 }
            };
          }
          if (command === 'routing_rule_page') return { profileId: args.profileId, offset: args.offset || 0, limit: args.limit || 80, total: 1, hasMore: false, items: [{ index: 1, kind: 'DOMAIN-SUFFIX', condition: state.activeProfileId + '.example.com', target: 'GLOBAL', status: 'readonly', options: [] }] };
          if (command === 'test_routing_website') return { domain: args.input, matched: true, source: 'subscription', target: 'GLOBAL', kind: 'DOMAIN-SUFFIX', condition: args.input, explanation: 'mock rule match' };
          if (command === 'connections') return [{ id: '1', target: 'example.com', rule: 'MATCH', route: ['GLOBAL', 'HK 01'], upload: 1, download: 2, process: 'browser.exe', network: 'tcp', protocol: 'HTTPS' }];
          if (command === 'active_connection_count') return { count: state.trafficTakeover ? 2 : 0, checkedAt: Date.now() };
          if (command === 'environment_readiness') {
            await new Promise((resolve) => setTimeout(resolve, 650));
            return {
            summary: { label: '环境可用', level: 'ok', errors: 0, warnings: 0 },
            checks: [
              { id: 'webview2', label: 'WebView2', detail: 'available', action: '', level: 'ok', ok: true },
              { id: 'admin', label: 'Administrator', detail: 'normal', action: '', level: 'ok', ok: true },
              { id: 'mixed-port', label: 'Proxy port', detail: 'available', action: '', level: 'ok', ok: true },
              { id: 'controller-port', label: 'Controller port', detail: 'available', action: '', level: 'ok', ok: true },
              { id: 'core-resource', label: 'Core file', detail: 'available', action: '', level: 'ok', ok: true }
            ]
          };
          }
          if (command === 'export_logs') return { path: 'C:\\Users\\Example\\AppData\\Roaming\\Aegos\\diagnostics\\aegos-logs-smoke.txt', count: status().logs.length };
          if (command === 'close_connection' || command === 'close_connections' || command === 'clear_logs') { await new Promise((resolve) => setTimeout(resolve, 350)); return true; }
          if (command === 'diagnostics') {
            await new Promise((resolve) => setTimeout(resolve, 350));
            return diagnosticsResult();
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
    const journeys = {
      startupTruth: false,
      tunOffConnection: false,
      tunOnConnection: false,
      measurementOnlySpeed: false,
      nodeAndOutboundIp: false,
      subscriptionLifecycle: false,
      routingRuleLifecycle: false,
      diagnosticsRepairAndExport: false,
      settingsAndEnvironment: false,
      nonBlockingBackgroundWork: false
    };
    const startupSpeedCalls = window.__aegosCalls.filter((item) => item.command === 'start_proxy_delay_test');
    if (startupSpeedCalls.length !== 1) throw new Error('startup did not launch exactly one Aegos-managed first speed test: ' + startupSpeedCalls.length);
    const startupStatusCall = window.__aegosCalls.find((item) => item.command === 'app_status');
    const startupGroupsCall = window.__aegosCalls.find((item) => item.command === 'proxy_groups');
    if (!startupStatusCall || !startupGroupsCall || startupSpeedCalls[0].at <= Math.max(startupStatusCall.at, startupGroupsCall.at)) throw new Error('startup speed test began before status and nodes were ready');
    if (window.__aegosCalls.some((item) => item.command === 'change_proxy' || (item.command === 'start_job' && item.args.kind === 'startCore'))) throw new Error('startup speed test changed the connection or selected proxy');
    const statusCenterCallsBefore = window.__aegosCalls.length;
    document.querySelector('#titlebarStatusCenterBtn').focus();
    document.querySelector('#titlebarStatusCenterBtn').click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (document.querySelector('#statusCenterOverlay')?.classList.contains('hidden')) throw new Error('status center did not open from titlebar');
    if (document.activeElement?.id !== 'closeStatusCenterBtn') throw new Error('status center did not receive focus');
    if (!document.querySelector('#statusCenterPanel .status-card #lanIpState')) throw new Error('status center did not preserve runtime status fields');
    if (window.__aegosCalls.length !== statusCenterCallsBefore) throw new Error('status center open triggered a backend command');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (!document.querySelector('#statusCenterOverlay')?.classList.contains('hidden')) throw new Error('status center did not close with Escape');
    if (document.activeElement?.id !== 'titlebarStatusCenterBtn') throw new Error('status center did not restore trigger focus');
    if (window.__aegosCalls.length !== statusCenterCallsBefore) throw new Error('status center close triggered a backend command');
    const statusCenterInitialBackendDelta = window.__aegosCalls.length - statusCenterCallsBefore;
    journeys.startupTruth = true;
    await click('#connectBtn');
    if (document.querySelector('#pageTitle')) throw new Error('duplicate top-left page title still renders');
    if (![...document.querySelectorAll('.status-card div')].some((item) => item.querySelector('dd#lanIpState') && item.querySelector('dt')?.textContent.includes('IP'))) throw new Error('network status did not render LAN IP label/value pair');
    if (document.querySelector('#lanIpState')?.textContent.trim() !== '192.168.1.2') throw new Error('network status did not render real LAN IP value');
    if (document.querySelector('#connectBtn')?.textContent.trim() !== '\u8fde\u63a5\u4e2d') throw new Error('connect button did not show pending connect feedback');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (document.querySelector('#connectBtn')?.textContent.trim() !== '\u65ad\u5f00\u8fde\u63a5') throw new Error('connect button did not reconcile to disconnect after start');
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'refreshOutboundIp')) throw new Error('first connect did not auto refresh outbound IP');
    journeys.tunOffConnection = true;
    if (document.querySelector('#quickIpBtn')) throw new Error('manual outbound IP quick action still renders');
    await click('#quickKillBtn');
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (!document.querySelector('#quickKillBtn .kill-icon')) throw new Error('disconnect protection icon is not using stable css icon');
    if (!document.querySelector('#quickKillBtn')?.classList.contains('active')) throw new Error('visible disconnect protection action did not update immediately');
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'updateSetting' && item.args.payload?.key === 'killSwitchEnabled')) throw new Error('quick kill protection did not call backend setting');
    await click('#quickUpdateSubBtn');
    if (!document.querySelector('[data-home-mode="region"]')?.classList.contains('active')) throw new Error('home did not default to common regions');
    if (!document.querySelector('[data-region="HK"]')?.classList.contains('active')) throw new Error('home did not default to Hong Kong region');
    if (document.querySelector('#homeRegionRow')?.classList.contains('hidden')) throw new Error('home common regions were hidden by default');
    if (document.querySelector('[data-page-jump="nodes"]')) throw new Error('all nodes shortcut still renders on home');
    const switchCallsBeforeSpeed = window.__aegosCalls.filter((item) => item.command === 'change_proxy' || (item.command === 'start_job' && item.args.kind === 'changeProxy')).length;
    await click('#quickTestBtn');
    await navDown('[data-page="nodes"]');
    await new Promise((resolve) => setTimeout(resolve, 380));
    if (document.querySelectorAll('#nodeRows .row[data-node]').length !== 89) throw new Error('ordinary subscription did not render all 89 nodes');
    if (document.querySelector('#nodeRows')?.textContent.includes('24 / 89')) throw new Error('node list still exposes the legacy 24-node truncation');
    if (!document.querySelector('#nodeRows .row[data-node]')?.textContent.includes('ms')) throw new Error('node page did not receive quick home speed results');
    const speedStartCall = window.__aegosCalls.find((item) => item.command === 'start_proxy_delay_test');
    if (!Array.isArray(speedStartCall?.args?.priorityNames) || speedStartCall.args.priorityNames.length === 0) throw new Error('speed test did not prioritize current visible nodes');
    if (window.__aegosCalls.some((item) => item.command === 'speed_test_status')) throw new Error('healthy speed event stream unnecessarily fell back to polling');
    await navDown('[data-page="settings"]');
    if (!document.querySelector('[data-page-panel="settings"]')?.classList.contains('active')) throw new Error('speed test blocked sidebar page switching');
    if (!document.querySelector('#killToggle')?.checked) throw new Error('settings page did not reconcile disconnect protection when it became visible');
    await navDown('[data-page="home"]');
    await click('[data-home-mode="favorite"]');
    await click('[data-home-mode="region"]');
    await click('[data-region="JP"]');
    await click('[data-region="HK"]');
    await new Promise((resolve) => setTimeout(resolve, 750));
    if (document.querySelector('#homeNodeRows [data-node-action="test"].is-pending')) throw new Error('home filter switch left rows stuck in testing state after speed test');
    const switchCallsAfterSpeed = window.__aegosCalls.filter((item) => item.command === 'change_proxy' || (item.command === 'start_job' && item.args.kind === 'changeProxy')).length;
    if (switchCallsAfterSpeed !== switchCallsBeforeSpeed) throw new Error('speed test triggered a proxy switch');
    journeys.measurementOnlySpeed = true;
    if (document.querySelector('#switchRecommendedBtn') || document.querySelector('.recommend-compact')) throw new Error('recommended switch control still renders');
    if (document.querySelector('#autoGroupNotice')?.classList.contains('hidden')) throw new Error('automatic strategy group warning did not render');
    if (document.querySelector('#bestNodeList') || document.querySelector('.best-node')) throw new Error('duplicate recommended node strip still renders');
    if (!document.querySelector('#quickTestBtn .icon-speed')) throw new Error('speed test quick action does not use lightning icon');
    if (document.querySelector('#systemProxyMetric')?.classList.contains('is-danger')) throw new Error('connected TUN-off system proxy metric stayed highlighted as disabled');
    if (!document.querySelector('#systemProxyMetric') || !document.querySelector('#upRate') || !document.querySelector('#downRate') || !document.querySelector('#stabilityMetric') || !document.querySelector('#activeConnectionsMetric') || !document.querySelector('#lastTestedMetric') || !document.querySelector('#currentNodeTestBtn')) throw new Error('home runtime metrics did not show proxy, traffic, stability, active connection, and test age state');
    if (document.querySelector('#tunMetric') || document.querySelector('#adminMetric') || document.querySelector('.traffic-card')) throw new Error('low-value home/sidebar metrics still render');
    await click('#lockAutoGroupBtn');
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'changeProxy')) throw new Error('auto group lock did not use background proxy change job');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'refreshOutboundIp')) throw new Error('node switch did not auto refresh outbound IP');
    if (!document.querySelector('#outboundMetric')?.textContent.includes('203.0.113.8')) throw new Error('auto refreshed outbound IP did not render');
    journeys.nodeAndOutboundIp = true;
    if (!document.querySelector('#homeNodeRows .row[data-node]')?.textContent.includes('ms')) throw new Error('home node delays did not update after quick speed test');
    const switchCallsBeforeCurrentNodeTest = window.__aegosCalls.filter((item) => item.command === 'change_proxy' || (item.command === 'start_job' && item.args.kind === 'changeProxy')).length;
    const currentNodeButton = document.querySelector('#currentNodeTestBtn');
    const currentNodeButtonWidth = currentNodeButton?.getBoundingClientRect().width || 0;
    currentNodeButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (!currentNodeButton?.matches('.metric-delay-action') || currentNodeButton.querySelector('#delayMetric') == null) throw new Error('current node delay value is not the speed-test action');
    if (currentNodeButton.querySelector('.aegos-icon') || document.querySelector('.metric-refresh')) throw new Error('separate current node speed-test icon still renders');
    if ((currentNodeButton?.textContent || '').length > 8) throw new Error('current node delay action replaced its value with busy text');
    if (!currentNodeButton?.classList.contains('is-pending')) throw new Error('current node delay action did not show pending state');
    if (Math.abs((currentNodeButton?.getBoundingClientRect().width || 0) - currentNodeButtonWidth) > 1) throw new Error('current node delay action changed width while pending');
    await navDown('[data-page="settings"]');
    if (!document.querySelector('[data-page-panel="settings"]')?.classList.contains('active')) throw new Error('single node speed test blocked sidebar page switching');
    await navDown('[data-page="nodes"]');
    await new Promise((resolve) => setTimeout(resolve, 520));
    const switchCallsAfterCurrentNodeTest = window.__aegosCalls.filter((item) => item.command === 'change_proxy' || (item.command === 'start_job' && item.args.kind === 'changeProxy')).length;
    if (!window.__aegosCalls.some((item) => item.command === 'test_single_proxy_delay')) throw new Error('current node delay refresh did not call single-node speed test');
    if (switchCallsAfterCurrentNodeTest !== switchCallsBeforeCurrentNodeTest) throw new Error('current node delay refresh triggered a proxy switch');
    if (!document.querySelector('#stabilityMetric')?.textContent.trim() || document.querySelector('#stabilityMetric')?.textContent.includes('\u672a')) throw new Error('current node stability did not render a real level');
    if (!document.querySelector('#currentNodeTestBtn > #delayMetric')) throw new Error('current node delay result is not rendered inside the speed-test action');
    const stabilityStyle = getComputedStyle(document.querySelector('#stabilityMetric'));
    if (stabilityStyle.backgroundColor !== 'rgba(0, 0, 0, 0)') throw new Error('home stability metric rendered a colored background block');
    if (!/metric-stability-(high|medium|low)/.test(document.querySelector('#stabilityMetric')?.className || '')) throw new Error('home stability metric did not use dedicated level text class');
    if (!document.querySelector('#lastTestedMetric')?.textContent.trim() || document.querySelector('#lastTestedMetric')?.textContent.includes('\u672a')) throw new Error('current node last tested time did not render after refresh');
    if (!document.querySelector('.delay-good') || !document.querySelector('.delay-bad')) throw new Error('delay color classes did not render green/red states');
    if (document.querySelector('#connectBtn')?.textContent.trim() === '\u65ad\u5f00\u8fde\u63a5') {
      await click('#connectBtn');
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    if (document.querySelector('#connectBtn')?.textContent.trim() !== '\u8fde\u63a5') throw new Error('disconnect did not return connect button to idle');
    const startCoreBeforeStandbySpeed = window.__aegosCalls.filter((item) => item.command === 'start_job' && item.args.kind === 'startCore').length;
    const switchCallsBeforeStandbySpeed = window.__aegosCalls.filter((item) => item.command === 'change_proxy' || (item.command === 'start_job' && item.args.kind === 'changeProxy')).length;
    await click('#quickTestBtn');
    const startCoreAfterStandbySpeed = window.__aegosCalls.filter((item) => item.command === 'start_job' && item.args.kind === 'startCore').length;
    const switchCallsAfterStandbySpeed = window.__aegosCalls.filter((item) => item.command === 'change_proxy' || (item.command === 'start_job' && item.args.kind === 'changeProxy')).length;
    if (startCoreAfterStandbySpeed !== startCoreBeforeStandbySpeed) throw new Error('standby speed test triggered the connect job');
    if (switchCallsAfterStandbySpeed !== switchCallsBeforeStandbySpeed) throw new Error('standby speed test triggered a proxy switch');
    if (document.querySelector('#connectBtn')?.textContent.trim() !== '\u8fde\u63a5') throw new Error('standby speed test changed the connect button to disconnect');
    document.querySelector('#quickProxyBtn').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (document.querySelector('#quickProxyBtn')?.disabled) throw new Error('home proxy quick action became blocking while backend was pending');
    if (!document.querySelector('#systemProxyToggle')?.checked) throw new Error('system proxy toggle did not update optimistically');
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (document.querySelector('#connectBtn')?.textContent.trim() !== '\u8fde\u63a5') throw new Error('manual system proxy toggle auto-connected traffic takeover');
    if (!document.querySelector('#systemProxyToggle')?.checked || document.querySelector('#systemProxyMetric')?.classList.contains('is-danger') === false) throw new Error('manual system proxy preference did not show pending connection state');
    const tunToggle = document.querySelector('#tunHomeToggle');
    tunToggle.click();
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (!tunToggle.checked || document.querySelector('#tunState')?.textContent.trim() !== '\u5df2\u5f00\u542f') throw new Error('TUN preference did not reconcile before connection');
    await click('#connectBtn');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (document.querySelector('#connectBtn')?.textContent.trim() !== '\u65ad\u5f00\u8fde\u63a5') throw new Error('TUN-on connection did not reach connected state');
    if (!document.querySelector('#tunHomeToggle')?.checked || document.querySelector('#tunState')?.textContent.trim() !== '\u5df2\u5f00\u542f') throw new Error('TUN-on connection lost TUN runtime truth');
    journeys.tunOnConnection = true;
    await click('#connectBtn');
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (document.querySelector('#connectBtn')?.textContent.trim() !== '\u8fde\u63a5') throw new Error('TUN-on disconnect did not restore idle connection state');
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
    const previewCallsBeforeProfileSwitch = window.__aegosCalls.filter((item) => item.command === 'preview_profile_groups').length;
    document.querySelector('#profileMenu [data-profile-switch="url-test"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    if (window.__aegosCalls.filter((item) => item.command === 'preview_profile_groups').length <= previewCallsBeforeProfileSwitch) throw new Error('quick subscription switch did not request local node preview');
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'setActiveProfile')) throw new Error('quick subscription menu did not switch through background job');
    await new Promise((resolve) => setTimeout(resolve, 420));
    const hkRows = [...document.querySelectorAll('#homeNodeRows .row[data-node]')].map((row) => row.dataset.node);
    if (!hkRows.length || hkRows.some((name) => !name.includes('HK'))) throw new Error('home region filter did not stay on home page');
    if (hkRows.length >= 2) {
      document.querySelectorAll('#homeNodeRows .row[data-node]')[1].click();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const hkRowsAfterSelect = [...document.querySelectorAll('#homeNodeRows .row[data-node]')].map((row) => row.dataset.node);
      if (hkRowsAfterSelect.join('\\n') !== hkRows.join('\\n')) throw new Error('home node row order changed after selection');
    }
    await navDown('[data-page="nodes"]');
    document.querySelector('#nodeProfileBtn')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (document.querySelector('#profileMenu')?.classList.contains('hidden')) throw new Error('node page subscription button did not open the shared menu');
    const nodeProfileMenuBox = document.querySelector('#profileMenu')?.getBoundingClientRect();
    const nodeProfileMenuTop = nodeProfileMenuBox ? document.elementFromPoint(nodeProfileMenuBox.left + nodeProfileMenuBox.width / 2, nodeProfileMenuBox.top + Math.min(28, nodeProfileMenuBox.height / 2)) : null;
    if (!nodeProfileMenuTop?.closest('#profileMenu')) throw new Error('node page subscription menu was covered by another layer');
    document.querySelector('#nodeProfileBtn')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (!document.querySelector('#profileMenu')?.classList.contains('hidden')) throw new Error('node page subscription button did not close the shared menu');
    await click('[data-region="HK"]');
    await click('#modeBtn');
    document.querySelector('[data-mode-option="global"]').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (document.querySelector('#modeLabel')?.textContent.trim() !== '\u5168\u5c40\u4ee3\u7406') throw new Error('mode label did not update optimistically');
    await new Promise((resolve) => setTimeout(resolve, 420));
    const connectionCallsBeforeNav = window.__aegosCalls.filter((item) => item.command === 'connections').length;
    const routingCallsBeforeNav = window.__aegosCalls.filter((item) => item.command === 'routing_snapshot').length;
    const diagnosticCallsBeforeNav = window.__aegosCalls.filter((item) => item.command === 'diagnostics' || (item.command === 'start_job' && item.args.kind === 'diagnostics')).length;
    await navDown('[data-page="connections"]');
    if (!document.querySelector('[data-page="connections"]')?.classList.contains('active')) throw new Error('sidebar navigation did not activate on pointerdown');
    if (!document.querySelector('[data-page-panel="connections"]')?.classList.contains('active')) throw new Error('connections page panel did not activate immediately');
    await navDown('[data-page="routing"]');
    if (!document.querySelector('[data-page="routing"]')?.classList.contains('active')) throw new Error('routing navigation did not activate on pointerdown');
    if (!document.querySelector('[data-page-panel="routing"]')?.classList.contains('active')) throw new Error('routing page panel did not activate immediately');
    await navDown('[data-page="settings"]');
    await navDown('[data-page="diagnostics"]');
    await navDown('[data-page="profiles"]');
    await navDown('[data-page="diagnostics"]');
    await navDown('[data-page="home"]');
    await navDown('[data-page="connections"]');
    await navDown('[data-page="settings"]');
    await new Promise((resolve) => setTimeout(resolve, 140));
    const connectionCallsAfterCancel = window.__aegosCalls.filter((item) => item.command === 'connections').length;
    const routingCallsAfterCancel = window.__aegosCalls.filter((item) => item.command === 'routing_snapshot').length;
    const diagnosticCallsAfterCancel = window.__aegosCalls.filter((item) => item.command === 'diagnostics' || (item.command === 'start_job' && item.args.kind === 'diagnostics')).length;
    if (connectionCallsAfterCancel !== connectionCallsBeforeNav) throw new Error('stale navigation data load was not cancelled after leaving the page');
    if (routingCallsAfterCancel !== routingCallsBeforeNav) throw new Error('stale routing data load was not cancelled after leaving the page');
    if (diagnosticCallsAfterCancel !== diagnosticCallsBeforeNav) throw new Error('rapid cached navigation triggered diagnostics before the quiet period');
    await navDown('[data-page="routing"]');
    await new Promise((resolve) => setTimeout(resolve, 900));
    if (!document.querySelector('#routingGroupRows .routing-row')) throw new Error('routing page did not render strategy rows after quiet load');
    if (!document.querySelector('#routingReadonlyBadge')?.textContent.includes('安全预览')) throw new Error('routing page did not keep safe preview badge visible');
    const routingAdvanced = document.querySelector('#routingAdvancedPanel');
    if (!routingAdvanced) throw new Error('routing advanced details control is missing');
    routingAdvanced.open = true;
    routingAdvanced.dispatchEvent(new Event('toggle'));
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (!document.querySelector('#routingRuleRows .routing-rule-row')?.textContent.includes('url-test.example.com')) throw new Error('routing page rendered a stale profile snapshot after subscription switch');
    if (document.querySelector('#routingRuleRows')?.textContent.includes('api.ipify.org')) throw new Error('routing page leaked Aegos internal landing IP rule into ordinary rules');
    if (document.querySelectorAll('#routingRuleRows .routing-rule-row').length > 80) throw new Error('routing advanced details exceeded the bounded row window');
    routingAdvanced.open = false;
    routingAdvanced.dispatchEvent(new Event('toggle'));
    if (document.querySelector('#routingSystemRuleCount')?.textContent.trim() !== '1') throw new Error('routing page did not count hidden system rules');
    document.querySelector('#routingRuleTestInput').value = 'www.url-test.example.com';
    await click('#testRoutingRuleBtn');
    if (!document.querySelector('#routingRuleTestResult')?.textContent.includes('GLOBAL')) throw new Error('routing rule test did not explain the matched target');
    await click('[data-routing-test-example="openai.com"]');
    if (document.querySelector('#routingRuleTestInput')?.value !== 'openai.com') throw new Error('routing rule test example did not fill the input');
    document.querySelector('#routingWebsiteInput').value = 'https://openai.com/docs';
    document.querySelector('#previewWebsiteRuleBtn').click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (!document.querySelector('#routingDraftPreview')?.dataset.rule?.includes('DOMAIN-SUFFIX,openai.com')) throw new Error('website routing preview did not create a safe draft');
    const callsBeforeAppDraft = window.__aegosCalls.length;
    document.querySelector('#routingAppInput').value = 'Telegram';
    document.querySelector('#previewAppRuleBtn').click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (!document.querySelector('#routingAppDraftPreview')?.dataset.rule?.includes('PROCESS-NAME,Telegram.exe')) throw new Error('app routing preview did not create a process-name draft');
    if (window.__aegosCalls.length !== callsBeforeAppDraft) throw new Error('app routing preview triggered a backend command');
    await click('#verifyAllRoutingDraftsBtn');
    if ([...document.querySelectorAll('#routingDraftList .routing-draft-row')].some((row) => !row.textContent.includes('\u5df2\u9a8c\u8bc1'))) throw new Error('routing draft verification did not mark every draft verified');
    await click('#applyRoutingDraftsBtn');
    await new Promise((resolve) => setTimeout(resolve, 520));
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'applyRoutingDrafts')) throw new Error('routing drafts did not use the safe deployment job');
    if (!document.querySelector('#routingApplyStatus')?.textContent.includes('\u5df2\u5e94\u7528')) throw new Error('routing apply did not show verified applied state');
    journeys.routingRuleLifecycle = true;
    if (document.querySelector('#routingModeState')?.textContent.trim() !== document.querySelector('#modeLabel')?.textContent.trim()) throw new Error('routing mode summary did not match current backend mode');
    await navDown('[data-page="diagnostics"]');
    await new Promise((resolve) => setTimeout(resolve, 900));
    const diagnosticCallsAfterSettle = window.__aegosCalls.filter((item) => item.command === 'diagnostics' || (item.command === 'start_job' && item.args.kind === 'diagnostics')).length;
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
    if (getComputedStyle(document.querySelector('#nodeEditUsernameRow')).display !== 'none') throw new Error('fixed node editor showed the username field for a protocol that does not use it');
    if (document.querySelector('#nodeEditSecretInput')?.type !== 'password') throw new Error('fixed node editor exposed a password as plain text');
    document.querySelector('#nodeEditNameInput').value = 'Fixed Smoke 01';
    document.querySelector('#nodeEditTypeSelect').value = 'socks5';
    document.querySelector('#nodeEditTypeSelect').dispatchEvent(new Event('change', { bubbles: true }));
    if (document.querySelector('#nodeEditUsernameRow')?.hidden) throw new Error('SOCKS5 fixed node editor did not show the authentication username field');
    document.querySelector('#nodeEditServerInput').value = '198.51.100.10';
    document.querySelector('#nodeEditPortInput').value = '1080';
    document.querySelector('#nodeEditUsernameInput').value = 'smoke-user';
    document.querySelector('#nodeEditSecretInput').value = 'smoke-password';
    await click('#saveNodeEditorBtn');
    const savedFixedNodeCall = window.__aegosCalls.find((item) => item.command === 'save_manual_node' && item.args?.node?.name === 'Fixed Smoke 01');
    if (!savedFixedNodeCall) throw new Error('fixed node editor did not save through backend command');
    if (savedFixedNodeCall.args.node.username !== 'smoke-user' || savedFixedNodeCall.args.node.password !== 'smoke-password') throw new Error('authenticated SOCKS5 fixed node did not save its username and password');
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
    await navDown('[data-page="home"]');
    await click('[data-home-mode="region"]');
    await click('[data-region="HK"]');
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (!document.querySelector('#homeNodeRows .row[data-node]')?.textContent.includes('ms')) throw new Error('home page did not receive node batch speed results');
    await navDown('[data-page="nodes"]');
    const lowRows = [...document.querySelectorAll('#nodeRows .row[data-node]')];
    const lowDelayValues = lowRows.map((row) => Number(row.querySelector('.delay-good')?.textContent.replace(/[^0-9]/g, '')));
    if (!lowRows.length || lowDelayValues.some((value) => !Number.isFinite(value) || value >= 100)) throw new Error('low latency filter included nodes at or above 100 ms');
    if (document.querySelector('#nodeRows .delay-bad')) throw new Error('low latency filter rendered a red high-latency node');
    document.querySelector('#nodeSearch').value = 'HK';
    document.querySelector('#nodeSearch').dispatchEvent(new Event('input', { bubbles: true }));
    const rowActionButtons = [...document.querySelectorAll('#nodeRows [data-node-action]')];
    if (rowActionButtons.length < 4) throw new Error('node row action buttons did not render');
    const rowActionBox = document.querySelector('#nodeRows .row-actions')?.getBoundingClientRect();
    const tableBox = document.querySelector('.node-table')?.getBoundingClientRect();
    if (!rowActionBox || !tableBox || rowActionBox.right > tableBox.right - 6) throw new Error('node row actions are too close to the table edge');
    if (document.querySelectorAll('.row-action-labels span').length !== 4) throw new Error('node action labels did not render');
    if (document.querySelector('#nodeRows .row[data-node]')?.children.length !== 7) throw new Error('node table did not render the expected status column');
    if (!document.querySelector('#nodeRows .row[data-node] .node-note')) throw new Error('node speed status note did not render');
    await click('#nodeRows [data-node-action="route"]');
    if (document.querySelector('#nodeGroupTargetEditor')?.classList.contains('hidden')) throw new Error('node route action did not open the target-site editor');
    await click('[data-close-node-target-editor]');
    await click('#nodeRows [data-node-action="edit"]');
    if (document.querySelector('#nodeEditorOverlay')?.classList.contains('hidden')) throw new Error('node edit action did not open the editor');
    const rowTestButton = document.querySelector('#nodeRows [data-node-action="test"]');
    const rowTestButtonWidth = rowTestButton?.getBoundingClientRect().width || 0;
    rowTestButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    if ((rowTestButton?.textContent || '').length > 4) throw new Error('node row icon test button rendered busy text');
    if (!rowTestButton?.classList.contains('is-pending')) throw new Error('node row icon test button did not show pending state');
    if (Math.abs((rowTestButton?.getBoundingClientRect().width || 0) - rowTestButtonWidth) > 1) throw new Error('node row icon test button changed width while pending');
    await new Promise((resolve) => setTimeout(resolve, 520));
    if (!window.__aegosCalls.some((item) => item.command === 'test_single_proxy_delay')) throw new Error('single node delay action did not call backend');
    await click('#nodeRows [data-node-action="favorite"]');
    await click('[data-node-filter="favorite"]');
    if (!document.querySelector('#nodeRows .row[data-node]')) throw new Error('favorite node filter did not show favorited node');
    await click('#nodeRows .row[data-node]');
    window.__aegosMockGroups.push(
      { name: 'Proxies', type: 'Selector', now: 'HK 01', items: window.__aegosMockGroups[0].items },
      { name: 'Spotify', type: 'Selector', now: 'HK 01', items: window.__aegosMockGroups[0].items.slice(0, 2) },
      { name: '鑷姩閫夋嫨', type: 'URLTest', now: 'HK 02', items: window.__aegosMockGroups[0].items }
    );
    setLatestGroups(structuredClone(window.__aegosMockGroups), 'Proxies');
    renderNodeGroupSwitcher();
    const groupCards = [...document.querySelectorAll('#nodeGroupStrip [data-node-group]')];
    if (groupCards.length < 3) throw new Error('strategy fixture did not render enough cards: ' + groupCards.length);
    if (groupCards.filter((item) => item.textContent.includes('自动选择')).length !== 1) throw new Error('legacy auto-select groups were not normalized and deduplicated');
    if (document.querySelector('#nodeGroupStrip')?.textContent.includes('鑷姩閫夋嫨')) throw new Error('legacy auto-select mojibake remained visible');
    const firstGroup = groupCards[0];
    const firstBox = firstGroup.getBoundingClientRect();
    firstGroup.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: firstBox.left + 10, clientY: firstBox.top + 10 }));
    document.querySelector('[data-node-group-menu-action="sort"]')?.click();
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const groupRegion = document.querySelector('#nodeGroupRegion');
    const nodeTableBeforeDrag = document.querySelector('.node-table');
    const regionBox = groupRegion?.getBoundingClientRect();
    const nodeTableBox = nodeTableBeforeDrag?.getBoundingClientRect();
    if (!regionBox || !nodeTableBox || regionBox.bottom > nodeTableBox.top + 1) throw new Error('strategy sort region overlapped the node table');
    const strip = document.querySelector('#nodeGroupStrip');
    const sortableCards = [...strip.querySelectorAll('[data-node-group]')];
    const sourceCard = sortableCards[0];
    const targetCard = sortableCards[1];
    const sourceBox = sourceCard.getBoundingClientRect();
    const targetBox = targetCard.getBoundingClientRect();
    const sourceName = sourceCard.dataset.nodeGroup;
    sourceCard.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 31, pointerType: 'mouse', clientX: sourceBox.left + 8, clientY: sourceBox.top + 8 }));
    strip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, buttons: 1, pointerId: 31, pointerType: 'mouse', clientX: targetBox.right - 4, clientY: targetBox.top + targetBox.height / 2 }));
    strip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerId: 31, pointerType: 'mouse', clientX: targetBox.right - 4, clientY: targetBox.top + targetBox.height / 2 }));
    if (strip.querySelector('[data-node-group]')?.dataset.nodeGroup === sourceName) throw new Error('pointer strategy-group drag did not change visual order');
    document.querySelector('[data-node-group-sort-done]')?.click();
    if (!document.querySelector('#nodeGroupSortBar')?.classList.contains('hidden')) throw new Error('strategy sort mode did not close cleanly');
    window.__aegosMockGroups.splice(1);
    setLatestGroups(structuredClone(window.__aegosMockGroups));
    renderNodeGroupSwitcher();
    await click('[data-page="connections"]');
    await click('#refreshConnectionsBtn');
    await new Promise((resolve) => setTimeout(resolve, 420));
    const callsBeforeConnectionDraft = window.__aegosCalls.length;
    await click('#connectionRows [data-routing-draft-target]');
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (!document.querySelector('[data-page-panel="routing"]')?.classList.contains('active')) throw new Error('connection draft action did not navigate to routing page');
    if (!document.querySelector('#routingDraftPreview')?.dataset.rule?.includes('DOMAIN-SUFFIX,example.com')) throw new Error('connection draft action did not create a routing draft');
    if (window.__aegosCalls.length !== callsBeforeConnectionDraft) throw new Error('connection draft action triggered a backend command');
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
    await click('[data-profile-rename="url-test"]');
    await new Promise((resolve) => setTimeout(resolve, 80));
    if (document.querySelector('#appDialogOverlay')?.classList.contains('hidden')) throw new Error('profile rename did not open app dialog');
    document.querySelector('#appDialogInput').value = 'Renamed Smoke Sub';
    document.querySelector('#appDialogForm').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
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
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (document.querySelector('#appDialogOverlay')?.classList.contains('hidden')) throw new Error('profile removal did not explain deletion impact');
    document.querySelector('#appDialogOkBtn')?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (document.querySelector('[data-profile-row="url-test"]')) throw new Error('profile row did not remove optimistically');
    await new Promise((resolve) => setTimeout(resolve, 420));
    journeys.subscriptionLifecycle = true;
    await click('[data-page="diagnostics"]');
    await click('#runDiagBtn');
    if (!document.querySelector('#runDiagBtn')?.classList.contains('is-pending')) throw new Error('diagnostics button did not show running feedback');
    await click('[data-diagnostic-view="logs"]');
    if (!document.querySelector('[data-diagnostic-view-panel="logs"]')?.classList.contains('active')) throw new Error('running diagnostics blocked the internal logs view');
    await navDown('[data-page="settings"]');
    if (!document.querySelector('[data-page-panel="settings"]')?.classList.contains('active')) throw new Error('running diagnostics blocked sidebar page switching');
    await navDown('[data-page="diagnostics"]');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await click('[data-diagnostic-view="overview"]');
    if (!document.querySelector('#diagSummary .diagnostic-status')) throw new Error('diagnostic summary did not render');
    if (!document.querySelector('#diagRows .diagnostic-row.severity-warning')) throw new Error('diagnostic severity row did not render');
    if (!document.querySelector('#diagRows .diagnostic-hint')) throw new Error('diagnostic actionable hint did not render');
    if (!document.querySelector('#diagRows .diagnostic-code')?.textContent.includes('AEG-')) throw new Error('diagnostic error code did not render');
    if (!document.querySelector('[data-diagnostic-group="node"]')) throw new Error('diagnostic category group did not render');
    await click('#diagRows [data-diagnostic-repair="restart-core"]');
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'repairDiagnostic')) throw new Error('diagnostic repair did not use the repair background job');
    await click('[data-diagnostic-view="logs"]');
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
    journeys.diagnosticsRepairAndExport = true;
    const environmentCallsBeforeSettings = window.__aegosCalls.filter((item) => item.command === 'environment_readiness').length;
    await click('[data-page="settings"]');
    await new Promise((resolve) => setTimeout(resolve, 220));
    if (!document.querySelector('.settings-summary-grid')) throw new Error('settings runtime summary did not render');
    if (document.querySelectorAll('[data-page-panel="settings"] .settings-section').length < 4) throw new Error('settings grouped sections did not render');
    if (!document.querySelector('#settingsTakeoverSummary')) throw new Error('settings takeover summary did not render');
    const environmentCallsAfterSettings = window.__aegosCalls.filter((item) => item.command === 'environment_readiness').length;
    if (environmentCallsAfterSettings !== environmentCallsBeforeSettings) throw new Error('opening settings automatically started the heavy system check');
    if (getComputedStyle(document.querySelector('#environmentRows')).overflowY === 'auto' || getComputedStyle(document.querySelector('#environmentRows')).overflowY === 'scroll') throw new Error('system check kept a nested scroll container');
    if (document.querySelector('.settings-advanced')?.open) throw new Error('advanced settings were expanded by default');
    document.querySelector('#refreshEnvironmentBtn')?.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const settingsExitStarted = performance.now();
    document.querySelector('[data-page="home"]')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    const settingsExitMs = performance.now() - settingsExitStarted;
    if (!document.querySelector('[data-page-panel="home"]')?.classList.contains('active') || settingsExitMs > 16) throw new Error('running system check blocked navigation away from settings');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await new Promise((resolve) => setTimeout(resolve, 900));
    await navDown('[data-page="settings"]');
    if (!document.querySelector('#environmentRows .environment-clear-state')) throw new Error('successful system check did not render a concise result');
    document.querySelector('#environmentDetailsBtn')?.click();
    if (document.querySelectorAll('#environmentRows .environment-row').length < 4) throw new Error('system check did not expose detailed checks on demand');
    if ([...document.querySelectorAll('#environmentRows .environment-row')].some((item) => /Administrator|Proxy port|Controller port/.test(item.textContent))) throw new Error('system check leaked technical English labels');
    journeys.settingsAndEnvironment = true;
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
    if (document.querySelector('#sidebarJobCount')?.textContent.trim() === '0') throw new Error('compact sidebar did not summarize active background jobs');
    if (!document.querySelector('#sidebarNodeName')?.textContent.trim()) throw new Error('compact sidebar did not summarize the current node');
    const statusCenterCallsWithJobs = window.__aegosCalls.length;
    document.querySelector('#sidebarStatusCenterBtn').click();
    if (!document.querySelector('#statusCenterPanel #jobRows')?.textContent.includes('startCore') && !document.querySelector('#statusCenterPanel #jobRows')?.textContent.includes('restartCore') && !document.querySelector('#statusCenterPanel #jobRows')?.textContent.includes('updateSettings')) throw new Error('status center did not show background jobs');
    if (window.__aegosCalls.length !== statusCenterCallsWithJobs) throw new Error('status center with jobs triggered a backend command');
    document.querySelector('#closeStatusCenterBtn').click();
    const statusCenterJobBackendDelta = window.__aegosCalls.length - statusCenterCallsWithJobs;
    const cancelJobButton = document.querySelector('#jobRows [data-job-cancel]');
    if (!cancelJobButton) throw new Error('background job center did not render cancel action');
    cancelJobButton.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    journeys.nonBlockingBackgroundWork = true;
    const commands = window.__aegosCalls.map((item) => item.command);
    const advancedSettingsCall = window.__aegosCalls.find((item) => item.command === 'start_job' && item.args.kind === 'updateSettings');
    const required = ['start_job', 'job_status', 'cancel_job', 'prepare_speed_runtime', 'start_proxy_delay_test', 'relaunch_as_admin', 'connections', 'close_connections'];
    const jobKinds = window.__aegosCalls.filter((item) => item.command === 'start_job').map((item) => item.args.kind);
    return {
      commands,
      missing: required.filter((name) => !commands.includes(name)),
      missingJobKinds: ['startCore', 'stopCore', 'restartCore', 'setMode', 'changeProxy', 'repairSystemProxy', 'setActiveProfile', 'removeProfile', 'renameProfile', 'updateSetting', 'updateSettings', 'refreshOutboundIp', 'diagnostics', 'updateProfile', 'updateAllProfiles', 'addProfileUrl', 'applyRoutingDrafts'].filter((name) => !jobKinds.includes(name)),
      journeys,
      forbiddenSideEffects: {
        speedProxySwitches: switchCallsAfterSpeed - switchCallsBeforeSpeed,
        standbySpeedConnections: startCoreAfterStandbySpeed - startCoreBeforeStandbySpeed,
        standbySpeedProxySwitches: switchCallsAfterStandbySpeed - switchCallsBeforeStandbySpeed,
        statusCenterInitialBackendCalls: statusCenterInitialBackendDelta,
        statusCenterJobBackendCalls: statusCenterJobBackendDelta
      },
      advancedSettings: advancedSettingsCall?.args?.payload?.updates || null,
      jobCenterText,
      notice: document.querySelector('#protectionNotice')?.textContent || ''
    };
  })()`);
  const missingJourneys = Object.entries(report.journeys || {}).filter(([, complete]) => !complete).map(([name]) => name);
  const forbiddenSideEffects = Object.entries(report.forbiddenSideEffects || {}).filter(([, count]) => Number(count) !== 0).map(([name, count]) => `${name}:${count}`);
  const ok = report.missing.length === 0 && report.missingJobKinds.length === 0 && missingJourneys.length === 0 && forbiddenSideEffects.length === 0;
  console.log(JSON.stringify({ ok, missingJourneys, forbiddenSideEffects, ...report }, null, 2));
  if (!ok) process.exitCode = 2;
} finally {
  try { page?.close(); } catch {}
  chrome.kill();
  await delay(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); } catch {}
}
