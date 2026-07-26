#!/usr/bin/env node
/* eslint-disable no-console */
import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corePath = path.join(repoRoot, 'resources', 'core', 'mihomo.exe');
const temporaryPrefix = path.join(os.tmpdir(), 'aegos-wm03-interruption-');
const timeoutMs = 45_000;
const evidencePath = path.join(repoRoot, '.validation', 'wr01', 'wm03-interruption-latest.json');

function fail(message) {
  throw new Error(message);
}

function writeEvidence(value) {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function exactProcess(pid) {
  if (!Number.isInteger(pid) || pid < 1) fail(`invalid process PID ${pid}`);
  const script = [
    `$process = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\"`,
    'if ($null -ne $process) {',
    '  [pscustomobject]@{ ProcessId = $process.ProcessId; CreationDate = $process.CreationDate; ExecutablePath = $process.ExecutablePath; CommandLine = $process.CommandLine } | ConvertTo-Json -Compress',
    '}',
  ].join('\n');
  const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  if (result.status !== 0) fail(`cannot inspect PID ${pid}: ${result.stderr.trim()}`);
  const output = result.stdout.trim();
  return output ? JSON.parse(output) : null;
}

function stopExactProcess(pid) {
  if (!Number.isInteger(pid) || pid < 1) fail(`invalid process PID ${pid}`);
  const result = run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Stop-Process -Id ${pid} -Force -ErrorAction Stop`,
  ]);
  if (result.status !== 0) fail(`cannot stop exact PID ${pid}: ${result.stderr.trim()}`);
}

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address();
      server.close((error) => {
        if (error) return reject(error);
        if (!address || typeof address === 'string' || address.port === 7890) {
          return reject(new Error('allocated an invalid test port'));
        }
        resolve(address.port);
      });
    });
  });
}

function waitForPort(port) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`port ${port} did not become ready`));
        } else {
          setTimeout(attempt, 50);
        }
      });
    };
    attempt();
  });
}

function waitForCheckpoint(controlPath) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (fs.existsSync(controlPath)) {
        clearInterval(timer);
        try {
          resolve(JSON.parse(fs.readFileSync(controlPath, 'utf8')));
        } catch (error) {
          reject(error);
        }
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('worker did not publish its ready checkpoint'));
      }
    }, 50);
  });
}

function validateManagedChild(child, expectedRoot) {
  if (!child) fail('test-owned child disappeared before interruption');
  if (path.resolve(child.ExecutablePath || '') !== path.resolve(corePath)) {
    fail(`refusing cleanup: child executable is not the test Mihomo resource (${child.ExecutablePath || 'missing'})`);
  }
  if (!String(child.CommandLine || '').includes(expectedRoot)) {
    fail('refusing cleanup: child command line does not reference this exact test root');
  }
}

async function main() {
  if (process.platform !== 'win32') fail('WM-03 interruption harness is Windows-only');
  const expectedClean = process.argv.includes('--expect-clean');
  const normalStop = process.argv.includes('--normal-stop');
  const poisonedLock = process.argv.includes('--poisoned-lock');
  const preController = process.argv.includes('--pre-controller');
  const transactionActive = process.argv.includes('--transaction-active');
  if (normalStop && !expectedClean) fail('normal stop requires --expect-clean');
  if (poisonedLock && preController) fail('poisoned and pre-controller modes are independent fixtures');
  if (transactionActive && (poisonedLock || preController)) fail('transaction fixture is independent of other modes');
  const root = `${temporaryPrefix}${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const controlPath = path.join(root, 'control.json');
  const releasePath = path.join(root, 'release');
  const sentinelRoot = path.join(root, 'sentinel');
  const [mixedPort, controllerPort, sentinelMixedPort, sentinelControllerPort] = await Promise.all([
    allocatePort(), allocatePort(), allocatePort(), allocatePort(),
  ]);
  if (new Set([mixedPort, controllerPort, sentinelMixedPort, sentinelControllerPort]).size !== 4) {
    fail('test ports must be distinct');
  }

  let worker;
  let sentinel;
  let sentinelIdentity;
  let checkpoint;
  let child;
  let observedLeak = false;
  let stage = 'created';
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(sentinelRoot, { recursive: true });
    const sentinelConfig = path.join(sentinelRoot, 'config.yaml');
    fs.writeFileSync(sentinelConfig, [
      `mixed-port: ${sentinelMixedPort}`,
      `external-controller: 127.0.0.1:${sentinelControllerPort}`,
      'log-level: silent',
      fs.readFileSync(path.join(repoRoot, 'src-tauri', 'fixtures', 'subscriptions', 'clash-basic.yaml'), 'utf8'),
    ].join('\n'));
    sentinel = childProcess.spawn(corePath, ['-d', sentinelRoot, '-f', sentinelConfig], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    await waitForPort(sentinelControllerPort);
    sentinelIdentity = exactProcess(sentinel.pid);
    validateManagedChild(sentinelIdentity, sentinelRoot);
    writeEvidence({
      schema: 'aegos.wm03.interruption-result/v1',
      ok: false,
      stage,
      rootName: path.basename(root),
      generatedAt: new Date().toISOString(),
    });
    worker = childProcess.spawn(
      'cargo',
      [
        'test',
        '--manifest-path',
        'src-tauri/Cargo.toml',
        'wm03_cleanup_interruptible_worker',
        '--',
        '--nocapture',
        '--test-threads=1',
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          AEGOS_WM03_WORKER_ROOT: root,
          AEGOS_WM03_WORKER_CONTROL: controlPath,
          AEGOS_WM03_WORKER_RELEASE: releasePath,
          AEGOS_WM03_WORKER_MIXED_PORT: String(mixedPort),
          AEGOS_WM03_WORKER_CONTROLLER_PORT: String(controllerPort),
          AEGOS_WM03_WORKER_MODE: transactionActive ? 'transaction' : (preController ? 'pre-controller' : (poisonedLock ? 'poisoned' : 'ready')),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const output = [];
    worker.stdout.on('data', (chunk) => output.push(chunk.toString()));
    worker.stderr.on('data', (chunk) => output.push(chunk.toString()));
    const workerExit = new Promise((resolve) => worker.once('exit', (code, signal) => resolve({ code, signal })));
    const workerFailure = new Promise((_, reject) => worker.once('error', reject));
    checkpoint = await Promise.race([
      waitForCheckpoint(controlPath),
      workerExit.then(({ code, signal }) => Promise.reject(new Error(`cargo worker exited before ready (code=${code}, signal=${signal || 'none'}): ${output.join('').slice(-2000)}`))),
      workerFailure,
    ]);
    stage = 'checkpoint-ready';
    const expectedPhase = transactionActive ? 'transaction' : (preController ? 'pre-controller' : (poisonedLock ? 'poisoned' : 'ready'));
    if (checkpoint.schema !== 'aegos.wm03.interruption-checkpoint/v1' || checkpoint.phase !== expectedPhase) {
      fail(`worker checkpoint is not the expected ${expectedPhase} WM-03 checkpoint`);
    }
    if (checkpoint.mixedPort !== mixedPort || checkpoint.controllerPort !== controllerPort) {
      fail('worker checkpoint does not identify this exact worker');
    }
    if (Boolean(checkpoint.operationActive) !== transactionActive) {
      fail('worker transaction activity does not match the requested fixture');
    }
    const workerProcess = exactProcess(checkpoint.workerPid);
    if (!workerProcess || !String(workerProcess.CommandLine || '').includes('wm03_cleanup_interruptible_worker')) {
      fail('worker checkpoint PID is not the targeted WM-03 test process');
    }
    child = exactProcess(checkpoint.childPid);
    validateManagedChild(child, root);
    stage = 'child-identity-verified';
    if (normalStop) {
      fs.writeFileSync(releasePath, 'release\n');
      stage = 'worker-released';
    } else {
      stopExactProcess(checkpoint.workerPid);
      stage = 'worker-interrupted';
    }
    await workerExit;
    stage = 'cargo-exited';
    const remaining = exactProcess(checkpoint.childPid);
    observedLeak = remaining !== null;
    const sentinelAfter = exactProcess(sentinel.pid);
    validateManagedChild(sentinelAfter, sentinelRoot);
    if (JSON.stringify(sentinelAfter) !== JSON.stringify(sentinelIdentity)) {
      fail('same-executable sentinel identity changed during worker interruption');
    }
    await waitForPort(sentinelControllerPort);
    if (expectedClean && observedLeak) fail('interruption leaked its exact test-owned managed child');
    if (!expectedClean && !observedLeak) fail('known-bad reproduction no longer leaks; update the expected assertion before repair work');
    const result = {
      schema: 'aegos.wm03.interruption-result/v1',
      expectedClean,
      normalStop,
      poisonedLock,
      preController,
      transactionActive,
      observedLeak,
      workerPid: checkpoint.workerPid,
      childPid: checkpoint.childPid,
      mixedPort,
      controllerPort,
      sentinelPid: sentinel.pid,
      sentinelControllerPort,
      rootName: path.basename(root),
      workerOutput: output.join('').slice(-4000),
    };
    writeEvidence(result);
    console.log(JSON.stringify(result));
  } finally {
    if (checkpoint?.childPid) {
      const remaining = exactProcess(checkpoint.childPid);
      if (remaining) {
        validateManagedChild(remaining, root);
        stopExactProcess(checkpoint.childPid);
      }
    }
    if (worker && worker.exitCode === null && worker.pid) {
      stopExactProcess(worker.pid);
    }
    if (sentinel?.pid) {
      const remaining = exactProcess(sentinel.pid);
      if (remaining) {
        validateManagedChild(remaining, sentinelRoot);
        stopExactProcess(sentinel.pid);
      }
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
  if (!expectedClean && !observedLeak) process.exitCode = 2;
}

main().catch((error) => {
  writeEvidence({
    schema: 'aegos.wm03.interruption-result/v1',
    ok: false,
    error: error.message,
    generatedAt: new Date().toISOString(),
  });
  console.error(`WM-03 interruption harness failed: ${error.message}`);
  process.exitCode = 1;
});
