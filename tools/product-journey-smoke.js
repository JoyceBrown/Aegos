import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const interactionSmoke = path.join(root, 'tools', 'interaction-smoke.js');
const evidencePath = path.join(root, `PRODUCT_SMOKE_${pkg.version}.json`);
const testRootPrefix = 'aegos-interaction-smoke-';
const requiredJourneys = [
  'startupTruth',
  'tunOffConnection',
  'tunOnConnection',
  'measurementOnlySpeed',
  'nodeAndOutboundIp',
  'subscriptionLifecycle',
  'routingRuleLifecycle',
  'diagnosticsRepairAndExport',
  'settingsAndEnvironment',
  'nonBlockingBackgroundWork'
];

const child = spawnSync(process.execPath, [interactionSmoke], {
  cwd: root,
  encoding: 'utf8',
  timeout: 180000,
  windowsHide: true,
  maxBuffer: 8 * 1024 * 1024
});

let interaction = null;
try {
  interaction = JSON.parse(String(child.stdout || '').trim());
} catch (error) {
  const result = {
    ok: false,
    version: pkg.version,
    failure: `interaction smoke did not return JSON: ${error.message}`,
    stdout: String(child.stdout || '').slice(-2000),
    stderr: String(child.stderr || '').slice(-2000),
    generatedAt: new Date().toISOString()
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(2);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function cleanupTestRoot(name) {
  if (!name?.startsWith(testRootPrefix) || path.basename(name) !== name) return false;
  const testRoot = path.join(os.tmpdir(), name);
  const deadline = Date.now() + 20000;
  let absentSince = 0;
  do {
    let pids = [];
  if (process.platform === 'win32') {
    const escapedRoot = testRoot.replace(/'/g, "''");
    const query = `Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*${escapedRoot}*' } | ForEach-Object { $_.ProcessId }`;
    pids = String(spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { encoding: 'utf8', windowsHide: true }).stdout || '').match(/\d+/g) || [];
    for (const pid of pids) spawnSync('taskkill', ['/pid', pid, '/t', '/f'], { stdio: 'ignore', windowsHide: true });
  }
  try {
    fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
    if (pids.length === 0 && !fs.existsSync(testRoot)) {
      if (!absentSince) absentSince = Date.now();
      if (Date.now() - absentSince >= 3000) return true;
    } else absentSince = 0;
    sleep(250);
  } while (Date.now() < deadline);
  return false;
}

const cleanupPassed = cleanupTestRoot(interaction.testRootName);
const residualTestRoots = cleanupPassed ? [] : [interaction.testRootName || 'missing-test-root-identity'];

const missingJourneys = requiredJourneys.filter((name) => interaction?.journeys?.[name] !== true);
const forbiddenSideEffects = Object.entries(interaction?.forbiddenSideEffects || {})
  .filter(([, count]) => Number(count) !== 0)
  .map(([name, count]) => ({ name, count }));
const ok = child.status === 0 && interaction?.ok === true && missingJourneys.length === 0 && forbiddenSideEffects.length === 0 && residualTestRoots.length === 0;
const evidence = {
  ok,
  version: pkg.version,
  journeys: interaction?.journeys || {},
  forbiddenSideEffects: interaction?.forbiddenSideEffects || {},
  missingJourneys,
  missingCommands: interaction?.missing || [],
  missingJobKinds: interaction?.missingJobKinds || [],
  residualTestRoots,
  commandCount: Array.isArray(interaction?.commands) ? interaction.commands.length : 0,
  generatedAt: new Date().toISOString()
};

if (ok && process.env.AEGOS_WRITE_EVIDENCE !== '0') {
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify({ ...evidence, evidencePath }, null, 2));
process.exit(ok ? 0 : 2);
