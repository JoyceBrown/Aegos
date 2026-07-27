import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
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

function terminateTestChromeProcesses(dir) {
  if (process.platform !== 'win32') return;
  const escapedDir = dir.replace(/'/g, "''");
  const query = `Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*${escapedDir}*' } | ForEach-Object { $_.ProcessId }`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], {
    encoding: 'utf8',
    windowsHide: true
  });
  for (const pid of String(result.stdout || '').match(/\d+/g) || []) {
    spawnSync('taskkill', ['/pid', pid, '/t', '/f'], { stdio: 'ignore', windowsHide: true });
  }
}

async function removeTestUserDataDir(dir) {
  const deadline = Date.now() + 5000;
  let absentSince = 0;
  do {
    terminateTestChromeProcesses(dir);
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
    } catch {}
    if (!fs.existsSync(dir)) {
      if (!absentSince) absentSince = Date.now();
      if (Date.now() - absentSince >= 1000) return true;
    } else {
      absentSince = 0;
    }
    await delay(200);
  } while (Date.now() < deadline);
  return !fs.existsSync(dir);
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
  '--disable-crashpad',
  '--disable-breakpad',
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
          networkAvailability: 'unverified',
          networkUsable: false,
          traffic: { up: 128, down: 256 },
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
            dnsMode: 'auto',
            dnsHijackEnabled: true,
            dnsCustomNameservers: [],
            ipv6Enabled: false,
            additionalRulesEnabled: false,
            additionalRules: [],
            overrideScriptEnabled: false,
            overrideScript: '',
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
          { id: 'direct', name: 'Direct', profile_type: 'builtin', updated_at: '0', nodeCount: 0, proxyGroupCount: 0, ruleCount: 0 },
          { id: 'url-test', name: 'Example Sub', profile_type: 'url', source_url: 'https://example.com/sub', hasSourceUrl: true, updated_at: '1', nodeCount: 89, proxyGroupCount: 1, ruleCount: 12, sourceFormat: 'clash-yaml', subscriptionUsage: { upload: 1024, download: 2048, total: 1048576, expire: 1800000000 } }
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
        window.__aegosFailNextStatusRead = false;
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
        let localBackups = [];
        const status = () => ({
          product: 'Aegos',
          appVersion: '${pkg.version}',
          running: state.running,
          coreReady: state.running,
          trafficTakeover: state.trafficTakeover,
          standby: state.running && !state.trafficTakeover,
          controller: state.running,
          mode: state.mode,
          traffic: state.traffic,
          logs: [
            { at: '10:00:00', level: 'info', category: 'runtime', line: 'Aegos started' },
            { at: '10:00:01', level: 'core', category: 'core', line: 'mihomo ready' },
            { at: '10:00:02', level: 'warn', category: 'diagnostic', line: 'Diagnostic warning' },
            { at: '10:00:03', level: 'debug', category: 'debug', line: 'debug detail' }
          ],
          activeProfile: profiles.find((item) => item.id === state.activeProfileId),
          network: {
            lanIp: '192.168.1.2',
            proxyEndpoint: '127.0.0.1:' + state.settings.mixedPort,
            outboundIp: '-',
            availability: {
              state: state.networkAvailability,
              networkUsable: state.networkUsable
            }
          },
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
            dnsMode: state.settings.dnsMode,
            dnsHijackEnabled: state.settings.dnsHijackEnabled,
            dnsCustomNameservers: state.settings.dnsCustomNameservers,
            killSwitchEnabled: state.killSwitchEnabled,
            ipv6Enabled: state.settings.ipv6Enabled,
            allowLan: false,
            tunStack: state.settings.tunStack,
            logLevel: state.settings.logLevel,
            configExtensions: {
              additionalRulesEnabled: state.settings.additionalRulesEnabled,
              additionalRules: state.settings.additionalRules,
              overrideScriptEnabled: state.settings.overrideScriptEnabled,
              overrideScript: state.settings.overrideScript,
              format: 'yaml'
            },
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
        window.__aegosState = state;
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
          if (command === 'app_status') {
            if (window.__aegosFailNextStatusRead) {
              window.__aegosFailNextStatusRead = false;
              throw new Error('mock transient status read failure');
            }
            return status();
          }
          if (command === 'start_core') { state.running = true; state.trafficTakeover = true; if (!state.tunEnabled) state.systemProxy = true; return { ok: true, trafficTakeover: true }; }
          if (command === 'stop_core') { state.running = false; state.trafficTakeover = false; state.systemProxy = false; return { ok: true, trafficTakeover: false }; }
          if (command === 'local_backup_snapshot') return { available: true, connected: state.running, backups: structuredClone(localBackups) };
          if (command === 'restart_core') { state.running = true; state.trafficTakeover = true; return { ok: true }; }
          if (command === 'proxy_groups') return structuredClone(groups);
          if (command === 'preview_profile_groups') return structuredClone(groups);
          if (command === 'config_extensions_preview') {
            if (window.__aegosDelayConfigPreview) {
              window.__aegosDelayConfigPreview = false;
              await new Promise((resolve) => setTimeout(resolve, 120));
            }
            const draft = args.draft || {};
            const rawRules = String(draft.additionalRulesText || '').split(/\\r?\\n/);
            const nextRules = rawRules.map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
            const currentRules = Array.isArray(state.settings.additionalRules) ? state.settings.additionalRules : [];
            const issues = [];
            const terminalIndex = rawRules.findIndex((line) => /^(MATCH|FINAL)\\s*,/i.test(line.trim()));
            if (draft.additionalRulesEnabled && terminalIndex >= 0) {
              issues.push({ code: 'terminal_rule', surface: 'rules', line: terminalIndex + 1, column: 1 });
            }
            const yamlLines = String(draft.overrideScript || '').split(/\\r?\\n/);
            const protectedIndex = yamlLines.findIndex((line) => /^(secret|external-controller|dns|tun|rules)\\s*:/i.test(line.trim()));
            if (draft.overrideScriptEnabled && protectedIndex >= 0) {
              issues.push({ code: 'protected_key', surface: 'override', line: protectedIndex + 1, column: 1 });
            }
            const nextSet = new Set(nextRules);
            const currentSet = new Set(currentRules);
            const rulesAdded = [...nextSet].filter((line) => !currentSet.has(line)).length;
            const rulesRemoved = [...currentSet].filter((line) => !nextSet.has(line)).length;
            const rulesEnabledChanged = Boolean(draft.additionalRulesEnabled) !== Boolean(state.settings.additionalRulesEnabled);
            const overrideEnabledChanged = Boolean(draft.overrideScriptEnabled) !== Boolean(state.settings.overrideScriptEnabled);
            const overrideChanged = String(draft.overrideScript || '').trim() !== String(state.settings.overrideScript || '').trim();
            const changed = rulesAdded > 0 || rulesRemoved > 0 || rulesEnabledChanged || overrideEnabledChanged || overrideChanged;
            return {
              valid: issues.length === 0,
              changed,
              issues,
              summary: {
                rulesBefore: currentRules.length,
                rulesAfter: nextRules.length,
                rulesAdded,
                rulesRemoved,
                rulesEnabledChanged,
                overrideChanged,
                overrideEnabledChanged,
                runtimeReload: changed
              }
            };
          }
          if (command === 'start_job') {
            const id = 'job-' + (jobs.size + 1);
            let result = {};
            const heldCorePower = (args.kind === 'startCore' || args.kind === 'stopCore')
              && window.__aegosHoldCorePower === args.kind;
            const failedCorePower = (args.kind === 'startCore' || args.kind === 'stopCore')
              && window.__aegosFailNextCorePower === args.kind;
            const standbyCorePower = args.kind === 'startCore'
              && window.__aegosStandbyNextCorePower === args.kind;
            if (args.kind === 'refreshOutboundIp') result = { ip: '203.0.113.8' };
            if (args.kind === 'diagnostics') result = diagnosticsResult();
            if (args.kind === 'createLocalBackup') {
              const backup = { id: 'backup-' + (localBackups.length + 1), createdAtMs: Date.now(), bytes: 768, itemCount: 3 };
              localBackups = [backup, ...localBackups];
              result = { backup };
            }
            if (args.kind === 'restoreLocalBackup') {
              if (state.running) throw new Error('Disconnect Aegos before restoring a local backup.');
              const backup = localBackups.find((item) => item.id === args.payload?.id);
              if (!backup) throw new Error('Missing local backup');
              result = { backup, connected: false, repairedProfiles: 0 };
            }
            if (args.kind === 'startCore' && !heldCorePower && !failedCorePower) {
              state.running = true;
              state.trafficTakeover = !standbyCorePower;
              state.systemProxy = !standbyCorePower && !state.tunEnabled;
              state.networkAvailability = standbyCorePower ? 'unverified' : 'available';
              state.networkUsable = !standbyCorePower;
              result = standbyCorePower
                ? { ok: true, trafficTakeover: false, message: '\u7cfb\u7edf\u4ee3\u7406\u63a5\u7ba1\u672a\u5b8c\u6210\uff0c\u6838\u5fc3\u5df2\u4fdd\u6301\u5f85\u547d\u3002\u8bf7\u5728\u8bca\u65ad\u4e2d\u68c0\u67e5 Windows \u7cfb\u7edf\u4ee3\u7406\u540e\u91cd\u8bd5\u8fde\u63a5\u3002' }
                : { ok: true, trafficTakeover: true };
            }
            if (args.kind === 'stopCore' && !heldCorePower && !failedCorePower) { state.running = false; state.trafficTakeover = false; state.systemProxy = false; result = { ok: true, trafficTakeover: false }; }
            if (args.kind === 'restartCore') { state.running = true; state.trafficTakeover = true; state.networkAvailability = 'available'; state.networkUsable = true; result = { ok: true, trafficTakeover: true }; }
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
            if (args.kind === 'editProfileSource') {
              const profile = profiles.find((item) => item.id === args.payload?.id);
              if (profile) profile.source_url = args.payload?.url;
              result = { profile };
            }
            if (args.kind === 'importProfileFile') {
              const profile = { id: 'file-test', name: args.payload?.name || 'local.yaml', profile_type: 'file', updated_at: '2', nodeCount: 1, proxyGroupCount: 1, ruleCount: 1, sourceFormat: 'clash-yaml' };
              profiles.push(profile);
              result = { profile };
            }
            if (args.kind === 'providerHealthcheck') result = { report: { available: true, providers: [], validation: 'profile-preflight' }, profile: { id: args.payload?.id, validation: 'profile-preflight', nodes: 89, groups: 1, rules: 12 }, selectionUnchanged: true };
            if (args.kind === 'updateAllProfiles') result = { updated: profiles.filter((item) => item.source_url), failed: [], total: 1 };
            if (args.kind === 'addProfileUrl') result = { profile: profiles[1] };
            if (args.kind === 'applyRoutingDrafts') result = {
              appliedCount: Array.isArray(args.payload?.drafts) ? args.payload.drafts.length : 0,
              profileName: profiles.find((item) => item.id === state.activeProfileId)?.name || 'Example Sub',
              rollbackAvailable: true,
              deploymentValidation: { controllerReady: true, runtimeIdentityOk: true, networkAvailable: true }
            };
            if (args.kind === 'undoRoutingApply') result = { undone: true, rollbackAvailable: false };
            if (args.kind === 'applyRoutingRuleEdit') result = { ok: true, action: args.payload?.action || 'add' };
            const keepRunning = (args.kind === 'updateAllProfiles' && args.payload?.keepRunning) || heldCorePower;
            const job = { id, kind: args.kind, label: args.kind, state: keepRunning ? 'running' : failedCorePower ? 'failed' : 'succeeded', progress: keepRunning ? 0 : 1, total: 1, message: keepRunning ? 'running' : failedCorePower ? 'mock core power failure' : 'done', result, error: failedCorePower ? 'mock core power failure' : null, cancellable: args.kind === 'updateAllProfiles' };
            jobs.set(id, job);
            return { ...job, state: 'running' };
          }
          if (command === 'job_status') {
            if (!args.id) return [...jobs.values()];
            const job = jobs.get(args.id) || { id: args.id, state: 'failed', message: 'missing mock job' };
            if ((job.kind === 'startCore' || job.kind === 'stopCore')
              && job.state === 'running'
              && window.__aegosHoldCorePower !== job.kind) {
              const starting = job.kind === 'startCore';
              state.running = starting;
              state.trafficTakeover = starting;
              state.systemProxy = starting && !state.tunEnabled;
              job.state = 'succeeded';
              job.progress = 1;
              job.message = 'done';
              job.result = { ok: true, trafficTakeover: starting };
              jobs.set(args.id, job);
            }
            return job;
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
            if (window.__aegosHoldSpeedTest) {
              return speedStatusSnapshot(true, 0);
            }
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
          if (command === 'manual_node_editor') {
            const node = args.name
              ? groups[0].items.find((item) => item.name === args.name && item.manual)
              : null;
            if (args.name && !node) throw new Error('Fixed node no longer exists: ' + args.name);
            return { node: node ? { ...node } : null, profileId: state.activeProfileId, dialerProxyGroups: ['HK Relay'] };
          }
          if (command === 'delete_manual_node') {
            groups.forEach((group) => {
              group.items = group.items.filter((item) => item.name !== args.name);
              if (group.now === args.name) group.now = group.items[0]?.name || '';
            });
            return { deleted: args.name, profileId: state.activeProfileId, settings: status().settings };
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
          if (command === 'update_setting') { await new Promise((resolve) => setTimeout(resolve, 350)); if (args.key === 'tunEnabled') state.tunEnabled = args.value; else state.settings[args.key] = args.value; return status().settings; }
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
          if (command === 'ipv6_dns_safety_snapshot') {
            const requested = state.settings.ipv6Enabled;
            const running = state.running;
            const delaySnapshot = Boolean(state.delayNextIpv6Snapshot);
            state.delayNextIpv6Snapshot = false;
            if (delaySnapshot) await new Promise((resolve) => setTimeout(resolve, 420));
            return {
            mode: requested ? 'enabled' : 'disabled',
            requested: { enabled: requested, state: requested ? 'enabled' : 'disabled' },
            localCapability: { state: 'available', available: true },
            nodeCapability: { state: running ? 'supported' : 'unknown', tested: running },
            runtimeConfig: { state: running ? (requested ? 'enabled' : 'disabled') : 'inactive', compiledEnabled: requested, deployed: running },
            effective: { state: running ? (requested ? 'active' : 'disabled') : 'inactive', active: running && requested },
            canChangeRequested: requested || running,
            changesConnection: false,
            localIpv6: { available: true, state: 'available' },
            currentNodeIpv4: { ok: running, ip: running ? '198.51.100.10' : null },
            currentNodeIpv6: { ok: running, ip: running ? '2001:db8::20' : null },
            nodeIpv6Support: running ? 'supported' : 'unknown',
            ipv6Leak: { level: 'none', blockedOrFallback: true, action: running ? 'enable-available' : 'wait-connection' },
            dnsLeak: { ok: true, detail: 'safe', hijackEnabled: state.settings.dnsHijackEnabled },
            plainPrompt: running ? '本机和当前节点支持 IPv6；可按需启用。' : '连接后检测当前节点的 IPv6 能力；请求状态不代表已经生效。',
            egressConsistency: {
              state: running ? 'consistent' : 'inactive',
              label: running ? '普通出口已验证' : '未连接',
              fixedNode: false,
              fixedEgressVerified: false,
              identity: {
                identityState: running ? 'verified' : 'inactive',
                requested: { node: 'HK 01', kind: 'selected' },
                runtime: { node: 'HK 01', kind: 'ordinary', active: running },
                observed: { ip: running ? '198.51.100.10' : '-', checkedAt: running ? 1 : 0, freshness: running ? 'current' : 'missing', contextMatches: running }
              },
              evidence: {
                ipv4Matches: running,
                dnsRouteConsistent: true,
                tunEnabled: state.tunEnabled,
                dnsProtected: running && state.tunEnabled && state.settings.dnsHijackEnabled,
                ipv6Requested: requested,
                ipv6Effective: running ? (requested ? 'active' : 'disabled') : 'inactive',
                ipv6Consistent: true
              },
              plainPrompt: running ? '普通出口、实际 IPv4、DNS 路由与 IPv6 策略已共同验证。' : '连接后才会验证固定出口、DNS、TUN 与 IPv6 一致性。'
            }
          };
          }
          if (command === 'dns_policy_snapshot') return {
            mode: state.settings.dnsMode,
            requestedMode: state.settings.dnsMode,
            effectiveMode: state.running ? state.settings.dnsMode : 'inactive',
            protectionState: !state.running
              ? 'ready'
              : state.settings.dnsMode === 'system'
                ? 'compatibility'
                : state.settings.dnsMode === 'secure' && !state.tunEnabled
                  ? 'needs-tun'
                  : state.tunEnabled && state.settings.dnsHijackEnabled
                    ? 'protected'
                    : 'encrypted',
            route: 'DIRECT',
            fixedNode: false,
            remote: false,
            tunEnabled: state.tunEnabled,
            hijackRequested: state.settings.dnsHijackEnabled,
            hijackConfigured: state.tunEnabled && state.settings.dnsHijackEnabled,
            hijackEffective: state.running && state.tunEnabled && state.settings.dnsHijackEnabled,
            hijackLocked: state.settings.dnsMode === 'system' || state.settings.dnsMode === 'secure',
            requiresTun: state.settings.dnsMode === 'secure' && !state.tunEnabled,
            running: state.running
          };
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
    await new Promise((resolve) => setTimeout(resolve, 500));
    const stoppedStartupSpeedCalls = window.__aegosCalls.filter((item) => item.command === 'start_proxy_delay_test');
    if (stoppedStartupSpeedCalls.length) throw new Error('automatic startup speed test implicitly started a stopped core');
    window.__aegosState.running = true;
    window.__aegosState.trafficTakeover = false;
    await refreshStatus(true);
    if (document.querySelector('.ring strong')?.textContent.includes('\u6838\u5fc3\u5f85\u547d') || document.querySelector('.notice')?.textContent.includes('\u6838\u5fc3\u5f85\u547d') || document.querySelector('.notice')?.textContent.includes('\u5c1a\u672a\u63a5\u7ba1')) {
      throw new Error('primary disconnected status exposed internal standby or takeover wording');
    }
    window.__aegosState.trafficTakeover = true;
    window.__aegosState.networkAvailability = 'checking';
    window.__aegosState.networkUsable = false;
    await refreshStatus(true);
    if (document.querySelector('#titlebarRuntimeIndicator')?.dataset.state === 'connected') {
      throw new Error('takeover without usable connectivity was presented as connected');
    }
    if (document.querySelector('.ring strong')?.textContent === '\u5df2\u8fde\u63a5' || document.querySelector('#protocolMetric')?.textContent === '\u5df2\u8fde\u63a5') {
      throw new Error('takeover without usable connectivity claimed an effective connection in the persistent status');
    }
    if (document.querySelector('#outboundMetricLabel')?.textContent !== '\u843d\u5730 IP') {
      throw new Error('outbound identity did not keep the conventional landing IP label');
    }
    window.__aegosState.networkAvailability = 'unavailable';
    await refreshStatus(true);
    await click('[data-page="connections"]');
    replaceChildrenSafe(document.querySelector('#connectionRows'), [connectionEmptyState()]);
    if (!document.querySelector('#connectionRows')?.textContent.includes('\u63a5\u7ba1\u5df2\u751f\u6548') || !document.querySelector('#connectionRows [data-page-jump="diagnostics"]')) {
      throw new Error('unavailable takeover used the ordinary connections empty state');
    }
    await click('#connectionRows [data-page-jump="diagnostics"]');
    if (!document.querySelector('[data-page-panel="diagnostics"]')?.classList.contains('active')) throw new Error('unavailable takeover guidance did not keep diagnostics reachable');
    await click('[data-page="home"]');
    window.__aegosState.networkAvailability = 'available';
    window.__aegosState.networkUsable = true;
    await refreshStatus(true);
    if (document.querySelector('#titlebarRuntimeIndicator')?.dataset.state !== 'connected') {
      throw new Error('verified usable connectivity was not presented as connected');
    }
    if (document.querySelector('.ring strong')?.textContent !== '\u5df2\u8fde\u63a5' || document.querySelector('#protocolMetric')?.textContent !== '\u5df2\u8fde\u63a5') {
      throw new Error('verified usable connectivity did not reconcile every persistent connection state');
    }
    window.__aegosState.trafficTakeover = false;
    window.__aegosState.networkAvailability = 'unverified';
    window.__aegosState.networkUsable = false;
    await refreshStatus(true);
    const startupSpeedDeadline = Date.now() + 4000;
    while (!window.__aegosCalls.some((item) => item.command === 'start_proxy_delay_test') && Date.now() < startupSpeedDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const startupSpeedCalls = window.__aegosCalls.filter((item) => item.command === 'start_proxy_delay_test');
    if (startupSpeedCalls.length !== 1) throw new Error('ready standby core did not launch exactly one Aegos-managed first speed test: ' + startupSpeedCalls.length);
    const startupStatusCall = window.__aegosCalls.find((item) => item.command === 'app_status');
    const startupGroupsCall = window.__aegosCalls.find((item) => item.command === 'proxy_groups');
    if (!startupStatusCall || !startupGroupsCall || startupSpeedCalls[0].at <= Math.max(startupStatusCall.at, startupGroupsCall.at)) throw new Error('startup speed test began before status and nodes were ready');
    if (window.__aegosCalls.some((item) => item.command === 'change_proxy' || (item.command === 'start_job' && item.args.kind === 'startCore'))) throw new Error('startup speed test changed the connection or selected proxy');
    if (document.querySelector('#nodeName')?.textContent.trim() !== 'HK 01' || document.querySelector('#nodeRegionBadge')?.textContent.trim() !== 'HK') {
      throw new Error('current node identity did not derive its name and region from the runtime node');
    }
    const truthfulNodeBeforeStatusFailure = document.querySelector('#nodeName')?.textContent.trim();
    const truthfulConnectionBeforeStatusFailure = document.querySelector('.ring strong')?.textContent.trim();
    window.__aegosFailNextStatusRead = true;
    await refreshStatus(true);
    if (document.querySelector('#nodeName')?.textContent.trim() !== truthfulNodeBeforeStatusFailure || document.querySelector('.ring strong')?.textContent.trim() !== truthfulConnectionBeforeStatusFailure) {
      throw new Error('transient app_status failure replaced the last truthful runtime snapshot');
    }
    if (!document.querySelector('#protectionNotice')?.textContent.includes('\u5f53\u524d\u663e\u793a\u4e0a\u6b21\u6570\u636e')) {
      throw new Error('transient app_status failure did not disclose stale status data');
    }
    if (!document.querySelector('#closeAllConnectionsBtn')?.disabled || !document.querySelector('#copyDiagBtn')?.disabled || !document.querySelector('#exportDiagBtn')?.disabled) {
      throw new Error('empty-state connection or diagnostic actions remained enabled');
    }
    const statusCenterCallsBefore = window.__aegosCalls.length;
    document.querySelector('#titlebarStatusCenterBtn').focus();
    document.querySelector('#titlebarStatusCenterBtn').click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (document.querySelector('#statusCenterOverlay')?.classList.contains('hidden')) throw new Error('status center did not open from titlebar');
    if (document.activeElement?.id !== 'closeStatusCenterBtn') throw new Error('status center did not receive focus');
    if (!document.querySelector('#statusCenterPanel .status-card #lanIpState')) throw new Error('status center did not preserve runtime status fields');
    if (document.querySelector('#statusCenterPanel')?.getBoundingClientRect().width > 321) throw new Error('status center is wider than the compact layout');
    if (window.__aegosCalls.length !== statusCenterCallsBefore) throw new Error('status center open triggered a backend command');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (!document.querySelector('#statusCenterOverlay')?.classList.contains('hidden')) throw new Error('status center did not close with Escape');
    if (document.activeElement?.id !== 'titlebarStatusCenterBtn') throw new Error('status center did not restore trigger focus');
    if (window.__aegosCalls.length !== statusCenterCallsBefore) throw new Error('status center close triggered a backend command');
    const statusCenterInitialBackendDelta = window.__aegosCalls.length - statusCenterCallsBefore;
    journeys.startupTruth = true;

    if (document.querySelector('#tunHomeState') || document.querySelector('.tun-home-toggle')?.textContent.includes('未开启')) {
      throw new Error('home TUN control still renders the removed state text');
    }
    const tunHomeControlBox = document.querySelector('.tun-home-toggle')?.getBoundingClientRect();
    const tunHomeSwitchBox = document.querySelector('#tunHomeToggle')?.getBoundingClientRect();
    if (!tunHomeControlBox || !tunHomeSwitchBox || Math.abs((tunHomeControlBox.top + tunHomeControlBox.height / 2) - (tunHomeSwitchBox.top + tunHomeSwitchBox.height / 2)) > 1.5) {
      throw new Error('home TUN switch is not vertically centered');
    }

    const mutationCommand = (item) => ['start_job', 'change_proxy', 'update_setting', 'update_settings', 'save_manual_node', 'delete_manual_node'].includes(item.command);
    const customizationMutationsBefore = window.__aegosCalls.filter(mutationCommand).length;
    const openContextMenu = async (selector) => {
      const target = document.querySelector(selector);
      if (!target) throw new Error('missing context target ' + selector);
      const rect = target.getBoundingClientRect();
      target.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + Math.min(16, rect.width / 2),
        clientY: rect.top + Math.min(12, rect.height / 2)
      }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      const menu = document.querySelector('#homeCustomizeContextMenu');
      if (!menu || menu.classList.contains('hidden')) throw new Error('home customization context menu did not open');
      const menuRect = menu.getBoundingClientRect();
      if (menuRect.left < 0 || menuRect.top < 0 || menuRect.right > window.innerWidth + 1 || menuRect.bottom > window.innerHeight + 1) {
        throw new Error('home customization context menu escaped the viewport');
      }
    };
    const submitDialogInput = async (value) => {
      const input = document.querySelector('#appDialogInput');
      if (!input) throw new Error('home customization input dialog did not open');
      input.value = value;
      document.querySelector('#appDialogForm').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 30));
    };

    const keyboardRegionTrigger = document.querySelector('[data-region="TW"]');
    keyboardRegionTrigger?.focus();
    keyboardRegionTrigger?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'F10',
      shiftKey: true,
      bubbles: true,
      cancelable: true
    }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (document.querySelector('#homeCustomizeContextMenu')?.getAttribute('role') !== 'menu' || !document.activeElement?.closest('#homeCustomizeContextMenu')) {
      throw new Error('home customization menu did not open and focus from Shift+F10');
    }
    if (document.querySelector('#homeCustomizeContextMenu')?.__aegosReturnFocus !== keyboardRegionTrigger) {
      throw new Error('home customization menu did not retain its keyboard return target');
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (document.activeElement !== keyboardRegionTrigger || !document.querySelector('#homeCustomizeContextMenu')?.classList.contains('hidden')) {
      throw new Error('home customization menu did not restore keyboard trigger focus: active=' + (document.activeElement?.outerHTML || 'none') + '; menu=' + document.querySelector('#homeCustomizeContextMenu')?.className);
    }

    await openContextMenu('[data-region="TW"]');
    await click('[data-home-customize-action="region-right"]');
    let storedRegions = JSON.parse(localStorage.getItem('aegos.homeRegions') || '[]');
    if (storedRegions.map((item) => item.code).join(',') !== 'HK,US,TW,JP,SG') throw new Error('home region reorder did not persist');

    await openContextMenu('[data-region="US"]');
    await click('[data-home-customize-action="region-add"]');
    await submitDialogInput('DE');
    await submitDialogInput('德国');
    storedRegions = JSON.parse(localStorage.getItem('aegos.homeRegions') || '[]');
    if (!document.querySelector('[data-region="DE"].active') || !storedRegions.some((item) => item.code === 'DE' && item.label === '德国')) {
      throw new Error('home region add did not render and persist');
    }

    await openContextMenu('[data-region="DE"]');
    await click('[data-home-customize-action="region-edit"]');
    await submitDialogInput('DE');
    await submitDialogInput('德语区');
    storedRegions = JSON.parse(localStorage.getItem('aegos.homeRegions') || '[]');
    if (document.querySelector('[data-region="DE"] .region-label')?.textContent !== '德语区' || !storedRegions.some((item) => item.code === 'DE' && item.label === '德语区')) {
      throw new Error('home region edit did not render and persist');
    }

    await openContextMenu('[data-region="DE"]');
    await click('[data-home-customize-action="region-delete"]');
    await click('#appDialogOkBtn');
    if (document.querySelector('[data-region="DE"]') || JSON.parse(localStorage.getItem('aegos.homeRegions') || '[]').some((item) => item.code === 'DE')) {
      throw new Error('home region delete did not render and persist');
    }

    await openContextMenu('[data-region="HK"]');
    await click('[data-home-customize-action="region-reset"]');
    await click('#appDialogOkBtn');
    storedRegions = JSON.parse(localStorage.getItem('aegos.homeRegions') || '[]');
    if (storedRegions.map((item) => item.code).join(',') !== 'HK,TW,US,JP,SG' || !document.querySelector('[data-region="HK"].active')) {
      throw new Error('home region defaults did not restore');
    }

    await openContextMenu('#quickProfileBtn');
    if (document.querySelector('[data-home-customize-action="quick-rename"]')) {
      throw new Error('quick actions still expose arbitrary label renaming');
    }
    const quickMenu = document.querySelector('#homeCustomizeContextMenu');
    const quickChoices = [...document.querySelectorAll('.quick-action-choice')];
    if (quickChoices.length < 12 || quickMenu?.getBoundingClientRect().height > 360 || quickMenu?.getBoundingClientRect().width > 370) {
      throw new Error('resident quick action picker is oversized or has too few choices');
    }
    if (quickChoices.some((choice) => {
      const label = choice.querySelector('b');
      return !choice.querySelector('.quick-action-choice-marker') || label?.scrollWidth > label?.clientWidth + 1;
    })) {
      throw new Error('resident quick action picker clips unselected labels');
    }
    await click('[data-home-customize-action="quick-toggle:quickProfileBtn"]');
    await click('[data-home-customize-action="quick-toggle:quickDiagnosticsBtn"]');
    let storedActions = JSON.parse(localStorage.getItem('aegos.quickActions') || '[]');
    const visibleQuickIds = [...document.querySelectorAll('[data-quick-action]:not(.hidden)')].map((button) => button.id);
    if (!document.querySelector('#quickProfileBtn')?.classList.contains('hidden') || document.querySelector('#quickDiagnosticsBtn')?.classList.contains('hidden') || storedActions.join(',') !== 'quickTestBtn,quickUpdateSubBtn,quickKillBtn,quickDiagnosticsBtn' || visibleQuickIds.length !== 4) {
      throw new Error('resident quick action selection did not render or persist');
    }
    if (window.__aegosCalls.filter(mutationCommand).length !== customizationMutationsBefore) {
      throw new Error('home customization triggered a backend mutation');
    }
    await click('#quickDiagnosticsBtn');
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'diagnostics')) {
      throw new Error('selected diagnostics quick action lost its original function');
    }
    await openContextMenu('#quickDiagnosticsBtn');
    await click('[data-home-customize-action="quick-toggle:quickNodesPageBtn"]');
    storedActions = JSON.parse(localStorage.getItem('aegos.quickActions') || '[]');
    if (storedActions.join(',') !== 'quickTestBtn,quickUpdateSubBtn,quickKillBtn,quickNodesPageBtn' || !document.querySelector('#quickDiagnosticsBtn')?.classList.contains('hidden') || document.querySelector('#quickNodesPageBtn')?.classList.contains('hidden')) {
      throw new Error('resident quick action replacement at the four-button limit failed');
    }
    const mutationsAfterDiagnostics = window.__aegosCalls.filter(mutationCommand).length;
    await openContextMenu('#quickNodesPageBtn');
    await click('[data-home-customize-action="quick-left"]');
    storedActions = JSON.parse(localStorage.getItem('aegos.quickActions') || '[]');
    if (storedActions.at(-2) !== 'quickNodesPageBtn' || window.__aegosCalls.filter(mutationCommand).length !== mutationsAfterDiagnostics) {
      throw new Error('resident quick action reorder did not persist');
    }
    await click('#quickNodesPageBtn');
    if (!document.querySelector('[data-page-panel="nodes"]')?.classList.contains('active')) {
      throw new Error('selected node-management quick action lost its original function');
    }
    await click('[data-page="home"]');
    const mutationsAfterQuickCommand = window.__aegosCalls.filter(mutationCommand).length;
    await openContextMenu('#quickNodesPageBtn');
    await click('[data-home-customize-action="quick-reset"]');
    await click('#appDialogOkBtn');
    storedActions = JSON.parse(localStorage.getItem('aegos.quickActions') || '[]');
    if (storedActions.join(',') !== 'quickTestBtn,quickUpdateSubBtn,quickKillBtn,quickProfileBtn' || document.querySelector('#quickProfileBtn')?.classList.contains('hidden') || !document.querySelector('#quickDiagnosticsBtn')?.classList.contains('hidden')) {
      throw new Error('quick action defaults did not restore');
    }
    if (window.__aegosCalls.filter(mutationCommand).length !== mutationsAfterQuickCommand) {
      throw new Error('restoring resident quick actions triggered a backend mutation');
    }

    await click('#connectBtn');
    if (document.querySelector('#pageTitle')) throw new Error('duplicate top-left page title still renders');
    if (document.querySelector('.sidebar-runtime-summary')) throw new Error('removed sidebar runtime summary still renders');
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
    if (document.querySelector('#quickKillBtn')?.getAttribute('role') !== 'switch' || document.querySelector('#quickKillBtn')?.getAttribute('aria-checked') !== 'true' || document.querySelector('#quickKillBtn')?.getAttribute('aria-label') !== '\u65ad\u7f51\u4fdd\u62a4' || document.querySelector('#quickKillState') || document.querySelector('#quickKillBtn .quick-action-label')?.textContent.trim() !== '\u65ad\u7f51\u4fdd\u62a4') throw new Error('disconnect protection must keep full wording without a redundant visible state suffix');
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'updateSetting' && item.args.payload?.key === 'killSwitchEnabled')) throw new Error('quick kill protection did not call backend setting');
    await click('#quickUpdateSubBtn');
    if (!document.querySelector('[data-home-mode="region"]')?.classList.contains('active')) throw new Error('home did not default to common regions');
    if (!document.querySelector('[data-region="HK"]')?.classList.contains('active')) throw new Error('home did not default to Hong Kong region');
    if (document.querySelector('#homeRegionRow')?.classList.contains('hidden')) throw new Error('home common regions were hidden by default');
    if (document.querySelector('[data-region="GB"]')) throw new Error('removed United Kingdom common-region card still renders');
    if (document.querySelector('[data-page-jump="nodes"]')) throw new Error('all nodes shortcut still renders on home');
    const switchCallsBeforeSpeed = window.__aegosCalls.filter((item) => item.command === 'change_proxy' || (item.command === 'start_job' && item.args.kind === 'changeProxy')).length;
    await click('#quickTestBtn');
    await navDown('[data-page="nodes"]');
    await new Promise((resolve) => setTimeout(resolve, 380));
    if (document.querySelector('[data-node-filter="recent"]')) throw new Error('removed recent-node filter still renders');
    const compactNodeHeader = document.querySelector('[data-page-panel="nodes"] .node-table > .row.head');
    if (compactNodeHeader?.children.length !== 6) throw new Error('node-page header did not remove the address column: ' + (compactNodeHeader?.children.length || 0) + ' / ' + (compactNodeHeader?.innerHTML || 'missing'));
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
    if (document.querySelector('.home-row-head')?.children.length !== 5) throw new Error('home header did not remove the address column');
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
    if (document.querySelector('#proxyState')?.classList.contains('is-danger')) throw new Error('connected TUN-off system proxy status stayed highlighted as disabled');
    if (document.querySelector('#systemProxyMetric') || document.querySelector('#networkAvailabilityMetric')) throw new Error('removed duplicate home status metrics still render');
    if (!document.querySelector('#upRate') || !document.querySelector('#downRate') || !document.querySelector('#stabilityMetric') || !document.querySelector('#activeConnectionsMetric') || !document.querySelector('#lastTestedMetric') || !document.querySelector('#currentNodeTestBtn')) throw new Error('node status card did not show traffic, stability, active connection, and test age state');
    if (document.querySelectorAll('.node-status-card > article').length !== 9 || !document.querySelector('.sidebar > .node-status-card')) throw new Error('node status metrics did not move to the sidebar bottom card');
    if (!document.querySelector('.node-column > .node-quick-actions') || document.querySelector('[data-page-panel="home"] > .quick')) throw new Error('quick actions did not move below the current node');
    if (document.querySelector('#tunMetric') || document.querySelector('#adminMetric') || document.querySelector('.traffic-card')) throw new Error('low-value home/sidebar metrics still render');
    await click('#lockAutoGroupBtn');
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'changeProxy')) throw new Error('auto group lock did not use background proxy change job');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'refreshOutboundIp')) throw new Error('node switch did not auto refresh outbound IP');
    if (!document.querySelector('#outboundMetric')?.textContent.includes('203.0.113.8') || document.querySelector('#outboundMetricLabel')?.textContent !== '\u843d\u5730 IP') throw new Error('auto refreshed verified outbound IP did not render as current');
    journeys.nodeAndOutboundIp = true;
    if (!document.querySelector('#homeNodeRows .row[data-node]')?.textContent.includes('ms')) throw new Error('home node delays did not update after quick speed test');
    const stabilityName = selectedNode || latestGroup?.now;
    speedResultOverlay.set(stabilityName, {
      delay: 300,
      alive: true,
      healthStatus: 'available',
      healthConfidence: 'high',
      lastTestedAt: Math.floor(Date.now() / 1000),
      stability10m: { samples: 3, variationPermille: 8 },
      stability30m: { samples: 3, variationPermille: 10 }
    });
    renderHomeNodeSummary(summaryRowsFromLatestGroup());
    if (document.querySelector('#stabilityMetric')?.textContent.trim() !== '\u9ad8') throw new Error('stable high-latency samples were incorrectly ranked as unstable');
    speedResultOverlay.set(stabilityName, {
      ...speedResultOverlay.get(stabilityName),
      stability10m: { samples: 3, variationPermille: 420 },
      stability30m: { samples: 3, variationPermille: 460 }
    });
    renderHomeNodeSummary(summaryRowsFromLatestGroup());
    if (document.querySelector('#stabilityMetric')?.textContent.trim() !== '\u4f4e') throw new Error('volatile rolling samples were not ranked as low stability');
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
    if (!/metric-stability-(high|medium|low|muted)/.test(document.querySelector('#stabilityMetric')?.className || '')) throw new Error('home stability metric did not use a dedicated level or sample-collection text class');
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
    if (document.querySelector('#quickProxyBtn') || document.querySelector('#quickRestartBtn')) throw new Error('removed infrequent quick actions still render');
    await navDown('[data-page="settings"]');
    document.querySelector('#systemProxyToggle').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (!document.querySelector('#systemProxyToggle')?.checked) throw new Error('system proxy toggle did not update optimistically');
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (document.querySelector('#connectBtn')?.textContent.trim() !== '\u8fde\u63a5') throw new Error('manual system proxy toggle auto-connected traffic takeover');
    if (!document.querySelector('#systemProxyToggle')?.checked || document.querySelector('#proxyState')?.classList.contains('is-danger') === false) throw new Error('manual system proxy preference did not show pending connection state');
    await navDown('[data-page="home"]');
    const tunToggle = document.querySelector('#tunHomeToggle');
    tunToggle.click();
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (!tunToggle.checked || document.querySelector('#tunState')?.textContent.trim() !== '\u8fde\u63a5\u65f6\u542f\u7528') throw new Error('TUN preference was presented as active takeover before connection');
    await click('#connectBtn');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (document.querySelector('#connectBtn')?.textContent.trim() !== '\u65ad\u5f00\u8fde\u63a5') throw new Error('TUN-on connection did not reach connected state');
    if (!document.querySelector('#tunHomeToggle')?.checked || document.querySelector('#tunState')?.textContent.trim() !== '\u5df2\u63a5\u7ba1') throw new Error('TUN-on connection did not render verified takeover truth');
    journeys.tunOnConnection = true;
    await click('#connectBtn');
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (document.querySelector('#connectBtn')?.textContent.trim() !== '\u8fde\u63a5') throw new Error('TUN-on disconnect did not restore idle connection state');
    if (document.querySelector('#quickProxyBtn') || document.querySelector('#quickRestartBtn') || document.querySelector('#quickTunBtn') || document.querySelector('#quickCopyProxyBtn') || document.querySelector('#smartRecoverBtn') || document.querySelector('#quickModeBtn')) throw new Error('removed quick actions still render');
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
    const outboundRefreshesBeforeMode = window.__aegosCalls.filter((item) => item.command === 'start_job' && item.args.kind === 'refreshOutboundIp').length;
    document.querySelector('[data-mode-option="global"]').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (document.querySelector('#modeLabel')?.textContent.trim() !== '\u5168\u5c40\u4ee3\u7406') throw new Error('mode label did not update optimistically');
    await new Promise((resolve) => setTimeout(resolve, 420));
    const outboundRefreshesAfterMode = window.__aegosCalls.filter((item) => item.command === 'start_job' && item.args.kind === 'refreshOutboundIp').length;
    if (window.__aegosState.trafficTakeover && outboundRefreshesAfterMode <= outboundRefreshesBeforeMode) throw new Error('connected mode switch did not invalidate and refresh outbound identity');
    const connectionCallsBeforeNav = window.__aegosCalls.filter((item) => item.command === 'connections').length;
    const routingCallsBeforeNav = window.__aegosCalls.filter((item) => item.command === 'routing_snapshot').length;
    const diagnosticCallsBeforeNav = window.__aegosCalls.filter((item) => item.command === 'diagnostics' || (item.command === 'start_job' && item.args.kind === 'diagnostics')).length;
    await navDown('[data-page="connections"]');
    if (!document.querySelector('[data-page="connections"]')?.classList.contains('active')) throw new Error('sidebar navigation did not activate on pointerdown');
    if (!document.querySelector('[data-page-panel="connections"]')?.classList.contains('active')) throw new Error('connections page panel did not activate immediately');
    if (document.querySelectorAll('.nav button[aria-current="page"]').length !== 1 || !document.querySelector('[data-page="connections"]')?.matches('[aria-current="page"]')) throw new Error('sidebar navigation does not expose one current page semantically');
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
    if (!document.querySelector('#routingReadonlyBadge')?.textContent.includes('预览模式')) throw new Error('routing page did not keep the not-yet-applied preview state visible');
    if (document.querySelector('.routing-draft-toolbar')) throw new Error('routing page kept duplicate draft controls above the builder');
    if (!document.querySelector('#routingDraftListCard')?.classList.contains('hidden')) throw new Error('empty routing draft area consumed page space');
    if (!document.querySelector('#routingSummaryDetail')?.classList.contains('hidden')) throw new Error('routing summary details expanded before the user requested them');
    await click('[data-routing-summary="user"]');
    if (document.querySelector('#routingSummaryDetail')?.classList.contains('hidden')) throw new Error('routing summary details did not expand on request');
    await click('[data-routing-summary="user"]');
    if (!document.querySelector('#routingSummaryDetail')?.classList.contains('hidden')) throw new Error('routing summary details did not collapse on repeated selection');
    const routingAdvanced = document.querySelector('#routingAdvancedPanel');
    if (!routingAdvanced) throw new Error('routing advanced details control is missing');
    routingAdvanced.open = true;
    routingAdvanced.dispatchEvent(new Event('toggle'));
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (routingAdvanced.querySelector('summary em')?.textContent !== '\u6536\u8d77') throw new Error('routing advanced disclosure did not show the collapse action');
    if (!document.querySelector('#routingRuleRows .routing-rule-row')?.textContent.includes('url-test.example.com')) throw new Error('routing page rendered a stale profile snapshot after subscription switch');
    if (document.querySelector('#routingRuleRows')?.textContent.includes('api.ipify.org')) throw new Error('routing page leaked Aegos internal landing IP rule into ordinary rules');
    if (document.querySelectorAll('#routingRuleRows .routing-rule-row').length > 80) throw new Error('routing advanced details exceeded the bounded row window');
    routingAdvanced.open = false;
    routingAdvanced.dispatchEvent(new Event('toggle'));
    if (routingAdvanced.querySelector('summary em')?.textContent !== '\u5c55\u5f00') throw new Error('routing advanced disclosure did not restore the expand action');
    if (document.querySelector('#routingSystemRuleCount')?.textContent.trim() !== '1') throw new Error('routing page did not count hidden system rules');
    await click('[data-routing-kind="test"]');
    if (!document.querySelector('[data-routing-panel="test"]')?.classList.contains('is-active')) throw new Error('rule test did not activate as a first-level task');
    document.querySelector('#routingRuleTestInput').value = 'www.url-test.example.com';
    await click('#testRoutingRuleBtn');
    if (!document.querySelector('#routingRuleTestResult')?.textContent.includes('GLOBAL')) throw new Error('routing rule test did not explain the matched target');
    await click('[data-routing-test-example="openai.com"]');
    if (document.querySelector('#routingRuleTestInput')?.value !== 'openai.com') throw new Error('routing rule test example did not fill the input');
    await click('[data-routing-kind="website"]');
    document.querySelector('#routingWebsiteInput').value = 'https://openai.com/docs';
    document.querySelector('#previewWebsiteRuleBtn').click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (!document.querySelector('#routingDraftPreview')?.dataset.rule?.includes('DOMAIN-SUFFIX,openai.com')) throw new Error('website routing preview did not create a safe draft');
    if (document.querySelector('#routingDraftListCard')?.classList.contains('hidden')) throw new Error('routing draft area did not appear after preview');
    const callsBeforeAppDraft = window.__aegosCalls.length;
    await click('[data-routing-kind="app"]');
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
    if (document.querySelector('#routingDraftListCard')?.classList.contains('hidden')) throw new Error('routing rollback action disappeared after apply');
    if (!document.querySelector('#routingDraftList')?.classList.contains('hidden')) throw new Error('empty routing draft rows remained visible after apply');
    if (document.querySelector('#undoRoutingApplyBtn')?.classList.contains('hidden')) throw new Error('routing rollback action is not visible after apply');
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
    if (!document.querySelector('#fixedNodeActions')?.classList.contains('hidden')) throw new Error('fixed-node add action leaked into the common-region page');
    await click('[data-region="TW"]');
    await click('[data-region="HK"]');
    if (!document.querySelector('[data-region="HK"]')?.classList.contains('active')) throw new Error('home region child filter did not become active');
    await click('[data-home-mode="fixed"]');
    if (!document.querySelector('[data-home-mode="fixed"]')?.classList.contains('active')) throw new Error('fixed node mode did not become active');
    if (document.querySelector('#fixedNodeActions')?.classList.contains('hidden')) throw new Error('fixed-node add action did not enter the fixed-node page');
    if (!document.querySelector('.home-filter-head > #fixedNodeActions > #addFixedNodeBtn')) throw new Error('fixed-node add action is not anchored in the fixed-node page header');
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
    const fixedHomeRow = document.querySelector('#homeNodeRows .row[data-node="Fixed Smoke 01"]');
    const fixedHomeBox = fixedHomeRow.getBoundingClientRect();
    fixedHomeRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: fixedHomeBox.left + 20, clientY: fixedHomeBox.top + 12 }));
    const fixedMenuBeforeData = document.querySelector('#fixedNodeContextMenu');
    if (!fixedMenuBeforeData || fixedMenuBeforeData.classList.contains('hidden')) throw new Error('fixed node context menu did not paint its stable shell immediately');
    if (!fixedMenuBeforeData.querySelector('[data-fixed-node-action="edit"]')) throw new Error('fixed node context menu painted an incomplete loading shell');
    const fixedMenuBeforeSize = { width: fixedMenuBeforeData.offsetWidth, height: fixedMenuBeforeData.offsetHeight };
    await new Promise((resolve) => setTimeout(resolve, 80));
    const fixedMenu = document.querySelector('#fixedNodeContextMenu');
    if (!fixedMenu || fixedMenu.classList.contains('hidden')) throw new Error('fixed node context menu did not open from the home fixed-node area');
    if (fixedMenu !== fixedMenuBeforeData) throw new Error('fixed node context menu was rebuilt after relay data arrived');
    const fixedMenuAfterSize = { width: fixedMenu.offsetWidth, height: fixedMenu.offsetHeight };
    if (Math.abs(fixedMenuAfterSize.width - fixedMenuBeforeSize.width) > 1 || Math.abs(fixedMenuAfterSize.height - fixedMenuBeforeSize.height) > 18) throw new Error('fixed node context menu changed geometry while relay data arrived');
    for (const action of ['test', 'edit', 'add', 'delete']) {
      if (!fixedMenu.querySelector('[data-fixed-node-action="' + action + '"]')) throw new Error('fixed node context menu is missing ' + action);
    }
    const dialerSelect = fixedMenu.querySelector('[data-fixed-node-dialer-proxy]');
    if (![...dialerSelect.options].some((option) => option.value === 'HK Relay')) throw new Error('fixed node context menu did not show eligible relay groups');
    dialerSelect.value = 'HK Relay';
    dialerSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 160));
    const relaySaveCall = [...window.__aegosCalls].reverse().find((item) => item.command === 'save_manual_node' && item.args?.node?.name === 'Fixed Smoke 01');
    if (relaySaveCall?.args?.node?.['dialer-proxy'] !== 'HK Relay') throw new Error('fixed node relay group did not save as dialer-proxy');
    await navDown('[data-page="nodes"]');
    const fixedNodePageRow = document.querySelector('#nodeRows .row[data-node="Fixed Smoke 01"]');
    if (!fixedNodePageRow) throw new Error('node page did not synchronize the saved fixed node');
    const fixedNodePageBox = fixedNodePageRow.getBoundingClientRect();
    fixedNodePageRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: fixedNodePageBox.left + 20, clientY: fixedNodePageBox.top + 12 }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    document.querySelector('#fixedNodeContextMenu [data-fixed-node-action="edit"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    if (document.querySelector('#nodeEditUsernameInput')?.value !== 'smoke-user' || document.querySelector('#nodeEditSecretInput')?.value !== 'smoke-password') throw new Error('fixed node editor did not restore persisted credentials');
    if (document.querySelector('#nodeEditDialerProxySelect')?.value !== 'HK Relay') throw new Error('fixed node editor did not restore the persisted relay group');
    await click('#cancelNodeEditorBtn');
    await navDown('[data-page="home"]');
    await click('[data-home-mode="fixed"]');
    const fixedDeleteRow = document.querySelector('#homeNodeRows .row[data-node="Fixed Smoke 01"]');
    const fixedDeleteBox = fixedDeleteRow.getBoundingClientRect();
    fixedDeleteRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: fixedDeleteBox.left + 20, clientY: fixedDeleteBox.top + 12 }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    document.querySelector('#fixedNodeContextMenu [data-fixed-node-action="delete"]')?.click();
    await click('#appDialogOkBtn');
    await new Promise((resolve) => setTimeout(resolve, 160));
    if (!window.__aegosCalls.some((item) => item.command === 'delete_manual_node' && item.args?.name === 'Fixed Smoke 01')) throw new Error('fixed node delete did not call the backend command');
    if (document.querySelector('#homeNodeRows .row[data-node="Fixed Smoke 01"]')) throw new Error('home page retained a deleted fixed node');
    await navDown('[data-page="nodes"]');
    if (document.querySelector('#nodeRows .row[data-node="Fixed Smoke 01"]')) throw new Error('node page retained a deleted fixed node');
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
    const sidebarTrafficBefore = String(document.querySelector('#upRate')?.textContent) + '|' + String(document.querySelector('#downRate')?.textContent);
    window.__aegosState.traffic = { up: 8192, down: 4096 };
    await refreshStatus(true);
    const sidebarTrafficAfter = String(document.querySelector('#upRate')?.textContent) + '|' + String(document.querySelector('#downRate')?.textContent);
    if (sidebarTrafficAfter === sidebarTrafficBefore) throw new Error('persistent traffic metrics became stale after leaving the home page');
    const lowRows = [...document.querySelectorAll('#nodeRows .row[data-node]')];
    const lowDelayValues = lowRows.map((row) => Number(row.querySelector('.delay-good')?.textContent.replace(/[^0-9]/g, '')));
    if (!lowRows.length || lowDelayValues.some((value) => !Number.isFinite(value) || value >= 100)) throw new Error('low latency filter included nodes at or above 100 ms');
    if (document.querySelector('#nodeRows .delay-bad')) throw new Error('low latency filter rendered a red high-latency node');
    document.querySelector('#nodeSearch').value = 'HK';
    document.querySelector('#nodeSearch').dispatchEvent(new Event('input', { bubbles: true }));
    const rowActionButtons = [...document.querySelectorAll('#nodeRows [data-node-action]')];
    if (rowActionButtons.length < 4) throw new Error('node row action buttons did not render');
    if (Number(getComputedStyle(document.querySelector('#nodeRows .row-actions')).opacity) < 0.7) throw new Error('available node actions still resemble disabled controls at rest');
    const rowActionBox = document.querySelector('#nodeRows .row-actions')?.getBoundingClientRect();
    const tableBox = document.querySelector('.node-table')?.getBoundingClientRect();
    if (!rowActionBox || !tableBox || rowActionBox.right > tableBox.right - 6) throw new Error('node row actions are too close to the table edge');
    if (document.querySelectorAll('.row-action-labels span').length !== 4) throw new Error('node action labels did not render');
    if (document.querySelector('#nodeRows .row[data-node]')?.children.length !== 6) throw new Error('node table did not render the compact columns with status');
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
    window.__aegosHoldSpeedTest = true;
    invalidatePageCache('routing');
    await testNodes(null, { automatic: true });
    const routingRaceCallsBefore = window.__aegosCalls.length;
    const routingNavigationStarted = performance.now();
    document.querySelector('[data-page="routing"]')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    const routingNavigationMs = performance.now() - routingNavigationStarted;
    if (!document.querySelector('[data-page-panel="routing"]')?.classList.contains('active') || routingNavigationMs > 16) throw new Error('automatic speed test blocked routing navigation');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!document.querySelector('.routing-assistant')) throw new Error('routing editor did not paint before snapshot loading');
    await new Promise((resolve) => setTimeout(resolve, 420));
    const routingRaceCalls = window.__aegosCalls.slice(routingRaceCallsBefore);
    const routingCancelIndex = routingRaceCalls.findIndex((item) => item.command === 'cancel_proxy_delay_test');
    const routingSnapshotIndex = routingRaceCalls.findIndex((item) => item.command === 'routing_snapshot');
    if (routingCancelIndex < 0 || routingSnapshotIndex < 0 || routingCancelIndex > routingSnapshotIndex) throw new Error('routing load did not preempt the automatic speed test before snapshot loading');
    window.__aegosHoldSpeedTest = false;
    await click('[data-page="connections"]');
    const callsBeforeConnectionDraft = window.__aegosCalls.length;
    await click('#connectionRows [data-routing-draft-target]');
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (!document.querySelector('[data-page-panel="routing"]')?.classList.contains('active')) throw new Error('connection draft action did not navigate to routing page');
    if (!document.querySelector('#routingDraftPreview')?.dataset.rule?.includes('DOMAIN-SUFFIX,example.com')) throw new Error('connection draft action did not create a routing draft');
    if (window.__aegosCalls.length !== callsBeforeConnectionDraft) throw new Error('connection draft action triggered a backend command');
    await click('[data-page="connections"]');
    await click('#refreshConnectionsBtn');
    for (let attempt = 0; attempt < 30 && (pageCacheState.connections.loading || document.querySelector('#closeAllConnectionsBtn')?.disabled); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (pageCacheState.connections.loading || document.querySelector('#closeAllConnectionsBtn')?.disabled) throw new Error('connection refresh did not make the destructive action available');
    document.querySelector('#closeAllConnectionsBtn').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (document.querySelector('#appDialogOverlay')?.classList.contains('hidden')) throw new Error('close all connections did not require confirmation');
    if (!document.querySelector('#connectionRows .simple-row')) throw new Error('connections cleared before destructive action confirmation');
    document.querySelector('#appDialogOkBtn')?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (document.querySelector('#connectionRows .simple-row')) throw new Error('connections did not clear optimistically');
    await new Promise((resolve) => setTimeout(resolve, 420));
    await click('[data-page="profiles"]');
    document.querySelector('[data-profile-switch="direct"]').click();
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
    if (!document.querySelector('[data-profile-row="url-test"]')?.textContent.includes('89 \u4e2a\u8282\u70b9 \u00b7 1 \u4e2a\u7b56\u7565\u7ec4 \u00b7 12 \u6761\u89c4\u5219')) throw new Error('profile metadata summary did not render');
    if (!document.querySelector('[data-profile-row="url-test"]')?.textContent.includes('流量')) throw new Error('profile traffic metadata did not render');
    const profileDetailNodes = [...document.querySelectorAll('[data-profile-row="url-test"] .profile-meta-summary, [data-profile-row="url-test"] .profile-source-summary, [data-profile-row="url-test"] .profile-usage-summary')];
    if (!profileDetailNodes.length || profileDetailNodes.some((node) => node.tabIndex !== 0 || !node.getAttribute('title') || !node.getAttribute('aria-label'))) throw new Error('truncated profile details do not expose a keyboard-accessible full value');
    await click('[data-profile-edit-source="url-test"]');
    await new Promise((resolve) => setTimeout(resolve, 40));
    document.querySelector('#appDialogInput').value = 'https://example.com/replaced-sub';
    document.querySelector('#appDialogForm').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'editProfileSource' && item.args.payload?.id === 'url-test')) throw new Error('profile source edit did not preserve identity through background job');
    await click('[data-profile-health="url-test"]');
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (!document.querySelector('[data-profile-row="url-test"]')?.textContent.includes('配置预检通过')) throw new Error('inactive profile health preflight did not render');
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
    const localProfileInput = document.querySelector('#profileFileInput');
    const localProfileTransfer = new DataTransfer();
    localProfileTransfer.items.add(new File(['proxies:\\n  - name: Local\\n    type: ss\\n    server: local.example\\n    port: 443\\n    cipher: aes-128-gcm\\n    password: fixture\\nproxy-groups:\\n  - name: Proxies\\n    type: select\\n    proxies: [Local]\\nrules: [MATCH,Proxies]\\n'], 'local-smoke.yaml', { type: 'text/yaml' }));
    Object.defineProperty(localProfileInput, 'files', { configurable: true, value: localProfileTransfer.files });
    localProfileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'importProfileFile')) throw new Error('local profile file did not use verified background import');
    if (!document.querySelector('[data-profile-row="file-test"]')) throw new Error('local profile import did not refresh profile rows');
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
    if (document.querySelectorAll('[data-settings-category]').length !== 7) throw new Error('settings category navigation did not render');
    if (document.querySelectorAll('[data-settings-panel].active').length !== 1) throw new Error('settings displayed more than one category at once');
    if (!document.querySelector('[data-settings-panel="takeover"]')?.classList.contains('active')) throw new Error('settings did not open on takeover controls');
    if (getComputedStyle(document.querySelector('.settings-overview')).display !== 'none') throw new Error('low-value settings dashboard remained visible');
    if (!document.querySelector('#settingsTakeoverSummary')) throw new Error('settings takeover summary did not render');
    const environmentCallsAfterSettings = window.__aegosCalls.filter((item) => item.command === 'environment_readiness').length;
    if (environmentCallsAfterSettings !== environmentCallsBeforeSettings) throw new Error('opening settings automatically started the heavy system check');
    const callsBeforeCategoryChange = window.__aegosCalls.length;
    await click('[data-settings-category="dns"]');
    if (!document.querySelector('[data-settings-panel="dns"]')?.classList.contains('active')) throw new Error('DNS settings category did not activate');
    if (document.querySelectorAll('[data-settings-panel].active').length !== 1) throw new Error('settings category switch left multiple panels visible');
    if (!document.querySelector('#dnsPolicyStatus') || !document.querySelector('#dnsPolicyTitle')?.textContent.includes('加密 DNS')) throw new Error('DNS settings did not expose the effective automatic policy');
    const systemDnsOption = document.querySelector('#dnsModeSelect option[value="system"]');
    if (!systemDnsOption?.disabled) throw new Error('system DNS remained selectable while TUN was enabled');
    document.querySelector('#dnsModeSelect').value = 'system';
    document.querySelector('#dnsModeSelect').dispatchEvent(new Event('change', { bubbles: true }));
    if (!document.querySelector('#saveDnsModeBtn')?.disabled || !document.querySelector('#dnsModeHint')?.textContent.includes('不能与 TUN')) throw new Error('system DNS and TUN conflict was not explained before apply');
    document.querySelector('#dnsModeSelect').value = 'auto';
    document.querySelector('#dnsModeSelect').dispatchEvent(new Event('change', { bubbles: true }));
    if (document.querySelector('#saveDnsModeBtn')?.disabled) throw new Error('valid automatic DNS mode remained blocked');
    if (window.__aegosCalls.length !== callsBeforeCategoryChange) throw new Error('settings category switch triggered backend calls');
    await click('[data-settings-category="environment"]');
    if (getComputedStyle(document.querySelector('#environmentRows')).overflowY === 'auto' || getComputedStyle(document.querySelector('#environmentRows')).overflowY === 'scroll') throw new Error('system check kept a nested scroll container');
    document.querySelector('#refreshEnvironmentBtn')?.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const settingsExitStarted = performance.now();
    document.querySelector('[data-page="home"]')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    const settingsExitMs = performance.now() - settingsExitStarted;
    if (!document.querySelector('[data-page-panel="home"]')?.classList.contains('active') || settingsExitMs > 16) throw new Error('running system check blocked navigation away from settings');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await new Promise((resolve) => setTimeout(resolve, 900));
    await navDown('[data-page="settings"]');
    await click('[data-settings-category="environment"]');
    if (!document.querySelector('#environmentRows .environment-clear-state')) throw new Error('successful system check did not render a concise result');
    await click('[data-settings-category="dns"]');
    if (!document.querySelector('#ipv6RequestedState') || !document.querySelector('#ipv6LocalCapabilityState') || !document.querySelector('#ipv6NodeCapabilityState') || !document.querySelector('#ipv6RuntimeConfigState') || !document.querySelector('#ipv6EffectiveState')) throw new Error('IPv6 request/capability/runtime/effective states were not separated');
    if (!document.querySelector('#egressConsistencyCard') || document.querySelector('#egressOverallState')?.textContent !== '普通出口已验证' || !document.querySelector('#egressDnsRouteState')?.textContent.includes('一致')) throw new Error('egress identity/DNS/TUN/IPv6 consistency report did not render');
    renderOutboundIpFromStatus('203.0.113.8', { state: 'stale', detail: 'old identity' });
    if (!document.querySelector('#outboundIpState')?.textContent.includes('历史')) throw new Error('stale outbound observation was displayed as current');
    outboundIpLastStable = '-';
    renderOutboundIpFromStatus('-', { state: 'failed', detail: 'provider unavailable' });
    if (document.querySelector('#outboundIpState')?.textContent !== '查询失败' || document.querySelector('#outboundMetric')?.textContent !== '查询失败') throw new Error('failed first outbound IP lookup was not displayed explicitly');
    renderOutboundIpFromStatus('203.0.113.8', { state: 'available' });
    if (document.querySelector('#ipv6Toggle')?.disabled || !document.querySelector('#ipv6ToggleHint')?.textContent.includes('均已验证支持')) throw new Error('verified IPv6 capability did not unlock the operation with an explicit reason');
    window.__aegosState.settings.ipv6Enabled = false;
    window.__aegosState.delayNextIpv6Snapshot = true;
    const slowIpv6Snapshot = refreshIpv6DnsSafety();
    await new Promise((resolve) => setTimeout(resolve, 20));
    window.__aegosState.settings.ipv6Enabled = true;
    refreshIpv6DnsSafety();
    const ipv6NavigationStarted = performance.now();
    document.querySelector('[data-settings-category="environment"]').click();
    const ipv6NavigationMs = performance.now() - ipv6NavigationStarted;
    if (!document.querySelector('[data-settings-panel="environment"]')?.classList.contains('active') || ipv6NavigationMs > 16) throw new Error('slow IPv6 capability check blocked settings navigation');
    await slowIpv6Snapshot;
    await new Promise((resolve) => setTimeout(resolve, 520));
    document.querySelector('[data-settings-category="dns"]').click();
    if (!document.querySelector('#ipv6Toggle')?.checked || document.querySelector('#ipv6RequestedState')?.textContent !== '已请求') throw new Error('stale IPv6 capability result overwrote the newer request state');
    await click('[data-settings-category="environment"]');
    document.querySelector('#environmentDetailsBtn')?.click();
    if (document.querySelectorAll('#environmentRows .environment-row').length < 4) throw new Error('system check did not expose detailed checks on demand');
    if ([...document.querySelectorAll('#environmentRows .environment-row')].some((item) => /Administrator|Proxy port|Controller port/.test(item.textContent))) throw new Error('system check leaked technical English labels');
    journeys.settingsAndEnvironment = true;
    if (window.__aegosState.running) {
      window.__aegosState.trafficTakeover = true;
      await refreshStatus(true);
      await click('#connectBtn');
      await new Promise((resolve) => setTimeout(resolve, 420));
      if (window.__aegosState.running) throw new Error('local backup setup did not disconnect the managed core');
    }
    await click('[data-settings-category="security"]');
    await new Promise((resolve) => setTimeout(resolve, 80));
    if (!document.querySelector('#localBackupPanel') || document.querySelector('#createLocalBackupBtn')?.disabled) throw new Error('local encrypted backup controls did not render for Windows');
    await click('#createLocalBackupBtn');
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'createLocalBackup')) throw new Error('local backup creation did not use a background job');
    const localRestoreButton = document.querySelector('#localBackupList button');
    if (!localRestoreButton || localRestoreButton.disabled) {
      const backupSnapshotCall = window.__aegosCalls.filter((item) => item.command === 'local_backup_snapshot').at(-1);
      throw new Error('disconnected local backup was not available for restore: ' + JSON.stringify({
        present: Boolean(localRestoreButton),
        disabled: Boolean(localRestoreButton?.disabled),
        summary: document.querySelector('#localBackupSummary')?.textContent || '',
        running: Boolean(window.__aegosState.running),
        backupSnapshotArgs: backupSnapshotCall?.args || null
      }));
    }
    localRestoreButton.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (document.querySelector('#appDialogOverlay')?.classList.contains('hidden')) throw new Error('local backup restore did not require confirmation');
    document.querySelector('#appDialogOkBtn')?.click();
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'restoreLocalBackup')) throw new Error('local backup restore did not use a background job');
    await click('#connectBtn');
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (!document.querySelector('#localBackupList button')?.disabled) throw new Error('connected Aegos did not explicitly block local backup restore');
    await click('#connectBtn');
    await new Promise((resolve) => setTimeout(resolve, 420));
    journeys.localBackupRecovery = true;
    const callsBeforeExtensionsCategory = window.__aegosCalls.length;
    await click('[data-settings-category="extensions"]');
    if (!document.querySelector('[data-settings-panel="extensions"]')?.classList.contains('active')) throw new Error('configuration extensions category did not activate');
    if (window.__aegosCalls.length !== callsBeforeExtensionsCategory) throw new Error('configuration extensions category switch triggered backend calls');
    const extensionsPanel = document.querySelector('[data-settings-panel="extensions"]');
    if (!extensionsPanel?.querySelector('.settings-workspace-head .config-extension-actions')) throw new Error('configuration extension actions are not kept beside the workspace title');
    if (!['auto', 'scroll'].includes(getComputedStyle(extensionsPanel).overflowY)) throw new Error('configuration extensions workspace cannot scroll when editors exceed the viewport');
    document.querySelector('#additionalRulesToggle').checked = true;
    document.querySelector('#additionalRulesToggle').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#additionalRulesInput').value = '# keep source line\\nMATCH,DIRECT';
    document.querySelector('#additionalRulesInput').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#overrideScriptToggle').checked = true;
    document.querySelector('#overrideScriptToggle').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#overrideScriptInput').value = 'sniffer:\\n  enable: true\\nsecret: exposed';
    document.querySelector('#overrideScriptInput').dispatchEvent(new Event('input', { bubbles: true }));
    await click('#previewConfigExtensionsBtn');
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (!document.querySelector('#saveConfigExtensionsBtn')?.disabled) throw new Error('invalid configuration extension preview enabled apply');
    const extensionIssueText = document.querySelector('#configExtensionsIssues')?.textContent || '';
    if (!extensionIssueText.includes('第 2 行') || !extensionIssueText.includes('第 3 行')) throw new Error('configuration extension preview did not expose safe line-level issues');
    if (extensionIssueText.includes('exposed')) throw new Error('configuration extension preview leaked a protected value');
    document.querySelector('#additionalRulesInput').value = 'DOMAIN-SUFFIX,example.com,Proxies';
    document.querySelector('#additionalRulesInput').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#overrideScriptInput').value = 'sniffer:\\n  enable: true';
    document.querySelector('#overrideScriptInput').dispatchEvent(new Event('input', { bubbles: true }));
    window.__aegosDelayConfigPreview = true;
    document.querySelector('#previewConfigExtensionsBtn').click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const previewNavigationStarted = performance.now();
    document.querySelector('[data-settings-category="dns"]').click();
    const previewNavigationMs = performance.now() - previewNavigationStarted;
    if (!document.querySelector('[data-settings-panel="dns"]')?.classList.contains('active') || previewNavigationMs > 16) throw new Error('configuration extension preview blocked settings navigation');
    document.querySelector('[data-settings-category="extensions"]').click();
    document.querySelector('#additionalRulesInput').value = 'DOMAIN-SUFFIX,stale.example,Proxies';
    document.querySelector('#additionalRulesInput').dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (!document.querySelector('#saveConfigExtensionsBtn')?.disabled || document.querySelector('#configExtensionsDiff')?.textContent) throw new Error('stale configuration extension preview overwrote the edited draft');
    document.querySelector('#additionalRulesInput').value = 'DOMAIN-SUFFIX,example.com,Proxies';
    document.querySelector('#additionalRulesInput').dispatchEvent(new Event('input', { bubbles: true }));
    await click('#previewConfigExtensionsBtn');
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (document.querySelector('#saveConfigExtensionsBtn')?.disabled) throw new Error('valid configuration extension preview did not enable apply');
    if (!document.querySelector('#configExtensionsDiff')?.textContent.includes('新增 1')) throw new Error('configuration extension intent diff was not rendered');
    await click('#saveConfigExtensionsBtn');
    await new Promise((resolve) => setTimeout(resolve, 80));
    const savedConfigExtensionsCall = [...window.__aegosCalls].reverse().find((item) => item.command === 'start_job' && item.args.kind === 'updateSettings' && item.args.payload?.updates?.additionalRulesEnabled === true);
    if (!savedConfigExtensionsCall) throw new Error('configuration extensions did not save through the settings background job');
    if (savedConfigExtensionsCall.args.payload.updates.additionalRules?.[0] !== 'DOMAIN-SUFFIX,example.com,Proxies') throw new Error('additional rules were not preserved as ordered rule lines');
    if (!savedConfigExtensionsCall.args.payload.updates.overrideScript?.includes('sniffer:')) throw new Error('override YAML was not preserved');
    document.querySelector('#additionalRulesInput').value = 'DOMAIN,changed.example,DIRECT';
    document.querySelector('#additionalRulesInput').dispatchEvent(new Event('input', { bubbles: true }));
    await click('#restoreConfigExtensionsBtn');
    if (document.querySelector('#additionalRulesInput').value !== 'DOMAIN-SUFFIX,example.com,Proxies') throw new Error('configuration extensions did not restore the latest successfully applied intent');
    if (!document.querySelector('#saveConfigExtensionsBtn')?.disabled) throw new Error('restored configuration extension draft remained applyable without a new preview');
    await click('[data-settings-category="takeover"]');
    await click('#repairProxyBtn');
    if (!window.__aegosCalls.some((item) => item.command === 'start_job' && item.args.kind === 'repairSystemProxy')) throw new Error('repair proxy button did not use repairSystemProxy job');
    await click('[data-settings-category="advanced"]');
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
    const statusCenterCallsWithJobs = window.__aegosCalls.length;
    document.querySelector('#titlebarStatusCenterBtn').click();
    if (!document.querySelector('#statusCenterPanel #jobRows')?.textContent.includes('startCore') && !document.querySelector('#statusCenterPanel #jobRows')?.textContent.includes('restartCore') && !document.querySelector('#statusCenterPanel #jobRows')?.textContent.includes('updateSettings')) throw new Error('status center did not show background jobs');
    if (window.__aegosCalls.length !== statusCenterCallsWithJobs) throw new Error('status center with jobs triggered a backend command');
    document.querySelector('#closeStatusCenterBtn').click();
    const statusCenterJobBackendDelta = window.__aegosCalls.length - statusCenterCallsWithJobs;
    if (document.querySelector('#jobRows [data-job-cancel]')) throw new Error('non-cancellable background task exposed an unsafe cancel action');
    window.__aegosState.running = false;
    window.__aegosState.trafficTakeover = false;
    window.__aegosState.systemProxy = false;
    renderStatus(await window.__TAURI__.core.invoke('app_status'));
    window.__aegosFailNextCorePower = 'startCore';
    await click('#connectBtn');
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (document.querySelector('.ring strong')?.textContent !== '\u672a\u8fde\u63a5') throw new Error('failed core start did not settle to disconnected state');
    if (document.querySelector('#connectBtn')?.textContent !== '\u8fde\u63a5') throw new Error('failed core start did not restore the connect action');
    window.__aegosFailNextCorePower = '';
    window.__aegosHoldCorePower = 'startCore';
    await click('#connectBtn');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const pendingStartRing = document.querySelector('.ring strong')?.textContent || '';
    const pendingStartNotice = document.querySelector('#protectionNotice')?.textContent || '';
    if (pendingStartRing === '\u5df2\u8fde\u63a5') throw new Error('pending core start claimed a verified connection');
    if (!document.querySelector('#connectBtn')?.textContent.includes('\u8fde\u63a5\u4e2d')) throw new Error('pending core start did not expose its pending state');
    if (pendingStartNotice.includes('\u5df2\u63a5\u7ba1')) throw new Error('pending core start claimed traffic takeover');
    window.__aegosHoldCorePower = '';
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (document.querySelector('.ring strong')?.textContent !== '\u5df2\u8fde\u63a5') throw new Error('verified core start did not settle to connected state');
    window.__aegosHoldCorePower = 'stopCore';
    await click('#connectBtn');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const pendingStopRing = document.querySelector('.ring strong')?.textContent || '';
    const pendingStopNotice = document.querySelector('#protectionNotice')?.textContent || '';
    if (pendingStopRing !== '\u5df2\u8fde\u63a5') throw new Error('pending core stop claimed a verified disconnect');
    if (!document.querySelector('#connectBtn')?.textContent.includes('\u65ad\u5f00\u4e2d')) throw new Error('pending core stop did not expose its pending state');
    if (pendingStopNotice.includes('\u5df2\u65ad\u5f00')) throw new Error('pending core stop claimed disconnect before terminal state');
    window.__aegosHoldCorePower = '';
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (document.querySelector('.ring strong')?.textContent !== '\u672a\u8fde\u63a5') throw new Error('verified core stop did not settle to disconnected state');
    window.__aegosStandbyNextCorePower = 'startCore';
    await click('#connectBtn');
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (document.querySelector('.ring strong')?.textContent !== '\u672a\u8fde\u63a5') throw new Error('takeover failure did not present the terminal disconnected state');
    if (document.querySelector('#connectBtn')?.textContent !== '\u8fde\u63a5') throw new Error('takeover failure did not restore the retry action');
    const standbyNotice = document.querySelector('#protectionNotice')?.textContent || '';
    if (!standbyNotice.includes('\u672a\u5b8c\u6210\u8fde\u63a5') || standbyNotice.includes('\u5df2\u65ad\u5f00')) throw new Error('takeover failure did not expose a remediation notice');
    window.__aegosStandbyNextCorePower = '';
    journeys.corePowerPendingUsesVerifiedState = true;
    const cancellableJob = await window.__TAURI__.core.invoke('start_job', { kind: 'updateAllProfiles', payload: { keepRunning: true } });
    rememberJob(cancellableJob);
    const cancelJobButton = document.querySelector('#jobRows [data-job-cancel]');
    if (!cancelJobButton) throw new Error('background job center did not render cancel action');
    cancelJobButton.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    journeys.nonBlockingBackgroundWork = true;
    const commands = window.__aegosCalls.map((item) => item.command);
    const advancedSettingsCall = window.__aegosCalls.find((item) => item.command === 'start_job' && item.args.kind === 'updateSettings' && item.args.payload?.updates?.mixedPort);
    const configExtensionsCall = window.__aegosCalls.find((item) => item.command === 'start_job' && item.args.kind === 'updateSettings' && item.args.payload?.updates?.additionalRulesEnabled === true);
    const required = ['start_job', 'job_status', 'cancel_job', 'start_proxy_delay_test', 'cancel_proxy_delay_test', 'relaunch_as_admin', 'connections', 'close_connections'];
    const jobKinds = window.__aegosCalls.filter((item) => item.command === 'start_job').map((item) => item.args.kind);
    return {
      commands,
      missing: required.filter((name) => !commands.includes(name)),
      missingJobKinds: ['startCore', 'stopCore', 'restartCore', 'setMode', 'changeProxy', 'repairSystemProxy', 'setActiveProfile', 'removeProfile', 'renameProfile', 'updateSetting', 'updateSettings', 'refreshOutboundIp', 'diagnostics', 'updateProfile', 'updateAllProfiles', 'addProfileUrl', 'applyRoutingDrafts', 'createLocalBackup', 'restoreLocalBackup'].filter((name) => !jobKinds.includes(name)),
      journeys,
      forbiddenSideEffects: {
        speedProxySwitches: switchCallsAfterSpeed - switchCallsBeforeSpeed,
        standbySpeedConnections: startCoreAfterStandbySpeed - startCoreBeforeStandbySpeed,
        standbySpeedProxySwitches: switchCallsAfterStandbySpeed - switchCallsBeforeStandbySpeed,
        statusCenterInitialBackendCalls: statusCenterInitialBackendDelta,
        statusCenterJobBackendCalls: statusCenterJobBackendDelta
      },
      advancedSettings: advancedSettingsCall?.args?.payload?.updates || null,
      configExtensions: configExtensionsCall?.args?.payload?.updates || null,
      jobCenterText,
      notice: document.querySelector('#protectionNotice')?.textContent || ''
    };
  })()`);
  const missingJourneys = Object.entries(report.journeys || {}).filter(([, complete]) => !complete).map(([name]) => name);
  const forbiddenSideEffects = Object.entries(report.forbiddenSideEffects || {}).filter(([, count]) => Number(count) !== 0).map(([name, count]) => `${name}:${count}`);
  const ok = report.missing.length === 0 && report.missingJobKinds.length === 0 && missingJourneys.length === 0 && forbiddenSideEffects.length === 0;
  console.log(JSON.stringify({ ok, missingJourneys, forbiddenSideEffects, testRootName: path.basename(userDataDir), ...report }, null, 2));
  if (!ok) process.exitCode = 2;
} finally {
  try { page?.close(); } catch {}
  terminateTestChromeProcesses(userDataDir);
  if (process.platform !== 'win32') chrome.kill();
  await removeTestUserDataDir(userDataDir);
}
