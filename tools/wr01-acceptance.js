import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validationRoot = path.join(root, '.validation');
const wr01Root = path.join(validationRoot, 'wr01');
const defaultReportPath = path.join(wr01Root, 'acceptance.json');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const npmCli = process.env.npm_execpath && fs.existsSync(process.env.npm_execpath)
  ? process.env.npm_execpath
  : path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

const requiredUiPages = ['home', 'nodes', 'connections', 'routing', 'profiles', 'diagnostics', 'settings'];
const requiredViewports = [
  '1280x820@1', '920x640@1', '980x640@1', '1280x700@1', '1180x700@1',
  '1180x720@1', '1440x900@1', '1536x960@1', '1700x900@1', '1280x1080@1',
  '1280x820@1.25', '1280x820@1.5', '1280x820@1.75', '1280x820@2'
];

function command(id, display, executable, args) {
  return { id, command: display, executable, args };
}

const requiredCommands = [
  command('git-diff-check', 'git diff --check', 'git', ['diff', '--check']),
  command('cargo-fmt-check', 'cargo fmt --manifest-path src-tauri/Cargo.toml -- --check', 'cargo', ['fmt', '--manifest-path', 'src-tauri/Cargo.toml', '--', '--check']),
  command('cargo-test', 'cargo test --manifest-path src-tauri/Cargo.toml', 'cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml']),
  command('app-js-syntax', 'node --check src/app.js', process.execPath, ['--check', 'src/app.js']),
  command('acceptance-js-syntax', 'node --check tools/wr01-acceptance.js', process.execPath, ['--check', 'tools/wr01-acceptance.js']),
  command('provenance-js-syntax', 'node --check tools/candidate-provenance-audit.js', process.execPath, ['--check', 'tools/candidate-provenance-audit.js']),
  command('license-audit', 'npm run audit:licenses', process.execPath, [npmCli, 'run', 'audit:licenses']),
  command('license-fixture-audit', 'npm run audit:licenses-fixtures', process.execPath, [npmCli, 'run', 'audit:licenses-fixtures']),
  command('npm-audit', 'npm audit --json', process.execPath, [npmCli, 'audit', '--json']),
  command('interaction-smoke', 'npm run smoke:interactions', process.execPath, [npmCli, 'run', 'smoke:interactions']),
  command('ui-smoke', 'npm run smoke:ui', process.execPath, [npmCli, 'run', 'smoke:ui']),
  command('perf-stress', 'npm run smoke:perf:stress', process.execPath, [npmCli, 'run', 'smoke:perf:stress']),
  command('soak-smoke', 'npm run smoke:soak', process.execPath, [npmCli, 'run', 'smoke:soak']),
  command('native-perf-enabled', 'npm run smoke:perf:native -- --automatic-speed=enabled', process.execPath, [npmCli, 'run', 'smoke:perf:native', '--', '--automatic-speed=enabled']),
  command('native-perf-suppressed', 'npm run smoke:perf:native -- --automatic-speed=suppressed', process.execPath, [npmCli, 'run', 'smoke:perf:native', '--', '--automatic-speed=suppressed']),
  command('backend-audit', 'npm run audit:backend', process.execPath, [npmCli, 'run', 'audit:backend']),
  command('responsiveness-audit', 'npm run audit:responsiveness', process.execPath, [npmCli, 'run', 'audit:responsiveness']),
  command('stability-audit', 'npm run audit:stability', process.execPath, [npmCli, 'run', 'audit:stability']),
  command('security-audit', 'npm run audit:security', process.execPath, [npmCli, 'run', 'audit:security']),
  command('ipv6-dns-audit', 'npm run audit:ipv6-dns', process.execPath, [npmCli, 'run', 'audit:ipv6-dns']),
  command('outbound-ip-audit', 'npm run audit:outbound-ip', process.execPath, [npmCli, 'run', 'audit:outbound-ip']),
  command('core-runtime-audit', 'npm run audit:core-runtime', process.execPath, [npmCli, 'run', 'audit:core-runtime']),
  command('runtime-regression-audit', 'npm run audit:runtime-regression', process.execPath, [npmCli, 'run', 'audit:runtime-regression']),
  command('routing-product-audit', 'npm run audit:routing-product', process.execPath, [npmCli, 'run', 'audit:routing-product']),
  command('routing-readonly-audit', 'npm run audit:routing-readonly', process.execPath, [npmCli, 'run', 'audit:routing-readonly']),
  command('connection-closure-audit', 'npm run audit:connection-closure', process.execPath, [npmCli, 'run', 'audit:connection-closure']),
  command('global-interaction-product-audit', 'npm run audit:global-interaction-product', process.execPath, [npmCli, 'run', 'audit:global-interaction-product']),
  command('debt-audit', 'npm run audit:debt', process.execPath, [npmCli, 'run', 'audit:debt']),
  command('control-plane-audit', 'npm run audit:control-plane', process.execPath, [npmCli, 'run', 'audit:control-plane']),
  command('architecture-audit', 'npm run audit:architecture', process.execPath, [npmCli, 'run', 'audit:architecture']),
  command('planning-context-audit', 'npm run audit:planning-context', process.execPath, [npmCli, 'run', 'audit:planning-context']),
  command('local-backup-audit', 'npm run audit:local-backup', process.execPath, [npmCli, 'run', 'audit:local-backup'])
];

const sourceDirectories = [
  'src', 'src-tauri/src', 'src-tauri/capabilities', 'src-tauri/icons',
  'third_party/mihomo', 'third_party/fluent-ui-system-icons', 'third_party/rust'
];
const sourceFiles = [
  'package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock',
  'src-tauri/tauri.conf.json', 'resources/core/mihomo.exe', 'LICENSE', 'THIRD_PARTY_NOTICES.md'
];
const gateFiles = [
  'AGENTS.md', 'PLANS.md', 'README.md', `RELEASE_${packageJson.version}.md`, 'package.json',
  'docs/INDEX.md', 'docs/product.md', 'docs/architecture.md', 'docs/roadmap.md',
  'docs/decisions/windows-reliability-mainline.md', 'docs/work/current.md',
  'docs/work/license-packaging-lic01.md',
  'docs/work/windows-reliability-wr01.md', 'docs/work/windows-reliability-wr02.md',
  'docs/work/windows-reliability-wr15.md',
  'tools/wr01-acceptance.js', 'tools/candidate-provenance-audit.js',
  'tools/generate-third-party-notices.js', 'tools/license-compliance-audit.js',
  'tools/installer-payload-audit.js', 'tools/release-audit.js',
  'tools/installer-candidate-audit.js', 'tools/installer-regression-audit.js',
  'src-tauri/tauri.native-perf.conf.json',
  'tools/wm03-interruption-harness.js', 'tools/planning-context-audit.js', 'tools/interaction-smoke.js',
  'tools/ui-smoke.js', 'tools/product-journey-smoke.js', 'tools/perf-smoke.js', 'tools/soak-smoke.js',
  'tools/native-perf-smoke.js', 'tools/backend-audit.js', 'tools/responsiveness-audit.js',
  'tools/stability-regression-audit.js', 'tools/security-hotfix-audit.js',
  'tools/ipv6-dns-safety-audit.js', 'tools/outbound-ip-audit.js', 'tools/core-runtime-audit.js',
  'tools/runtime-regression-gate-audit.js', 'tools/routing-product-audit.js',
  'tools/routing-readonly-audit.js', 'tools/connection-closure-audit.js',
  'tools/global-interaction-product-audit.js', 'tools/debt-audit.js', 'tools/control-plane-audit.js',
  'tools/architecture-freeze-audit.js', 'tools/local-backup-audit.js'
];
const expectedFindings = ['WR01-001', 'WR01-002', 'WR01-003', 'WR01-004', 'WR01-005', 'WR01-006', 'WR01-007'];
const boundary = 'host-safe:no-windows-takeover:no-flclash-mutation';

const baseline = Object.freeze({
  rust: { discoveredAtLeast: 222, failed: 0, ignored: 0 },
  ui: { pages: requiredUiPages, viewports: requiredViewports },
  perf: { nodeCountAtLeast: 800, navigationCountAtLeast: 420 },
  soak: { cyclesAtLeast: 16 },
  requiredCommands: requiredCommands.map(({ id, command: display }) => ({ id, command: display }))
});

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function relative(filePath) {
  return path.relative(root, filePath).replaceAll('\\', '/');
}

function collectDirectory(relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(relativeDirectory, entry.name);
    return entry.isDirectory() ? collectDirectory(next) : entry.isFile() ? [next.replaceAll('\\', '/')] : [];
  });
}

function digestInputs(files) {
  const entries = [...new Set(files)].sort().map((file) => {
    const filePath = path.join(root, file);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Required acceptance input is missing: ${file}`);
    }
    const content = fs.readFileSync(filePath);
    return { file, size: content.length, sha256: sha256(content) };
  });
  return { digest: sha256(JSON.stringify(entries)), entries };
}

function currentDigests() {
  return {
    source: digestInputs([...sourceFiles, ...sourceDirectories.flatMap(collectDirectory)]),
    gate: digestInputs(gateFiles),
    baseline: sha256(JSON.stringify(baseline))
  };
}

function commandValue(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : 'unavailable';
}

function gitIdentity() {
  const head = commandValue('git', ['rev-parse', 'HEAD']);
  const status = commandValue('git', ['status', '--porcelain=v1']);
  return { head, dirty: status.length > 0, worktreeStatusSha256: sha256(status) };
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function deriveMatrix(commandResults) {
  const cargo = commandResults.find((item) => item.id === 'cargo-test');
  const cargoLog = cargo ? fs.readFileSync(path.join(root, cargo.logPath), 'utf8') : '';
  const rustMatch = cargoLog.match(/test result: ok\.\s+(\d+) passed;\s+(\d+) failed;\s+(\d+) ignored;/);
  const product = readJson(`PRODUCT_SMOKE_${packageJson.version}.json`);
  const perf = readJson(`PERFORMANCE_PRESSURE_${packageJson.version}.json`);
  const soak = readJson(`PERFORMANCE_SOAK_${packageJson.version}.json`);
  const nativeEnabled = readJson(`PERFORMANCE_NATIVE_${packageJson.version}.auto-speed-enabled.json`);
  const nativeSuppressed = readJson(`PERFORMANCE_NATIVE_${packageJson.version}.auto-speed-suppressed.json`);
  return {
    rust: rustMatch ? { discovered: Number(rustMatch[1]), failed: Number(rustMatch[2]), ignored: Number(rustMatch[3]), commandId: 'cargo-test' } : {},
    ui: { pages: requiredUiPages, viewports: requiredViewports, commandId: 'ui-smoke', configurationIdentity: 'gate-bound' },
    perf: { nodeCount: Number(perf?.fixture?.nodeCount), navigationCount: Number(perf?.nav?.count), report: `PERFORMANCE_PRESSURE_${packageJson.version}.json`, ok: perf?.ok === true },
    soak: { cycles: Number(soak?.cycles), report: `PERFORMANCE_SOAK_${packageJson.version}.json`, ok: soak?.ok === true },
    product: { journeys: Object.values(product?.journeys || {}).filter(Boolean).length, missingJourneys: product?.missingJourneys || [], residualTestRoots: product?.residualTestRoots || [], report: `PRODUCT_SMOKE_${packageJson.version}.json`, ok: product?.ok === true },
    native: {
      enabled: { ok: nativeEnabled?.failures?.length === 0, report: `PERFORMANCE_NATIVE_${packageJson.version}.auto-speed-enabled.json` },
      suppressed: { ok: nativeSuppressed?.failures?.length === 0, report: `PERFORMANCE_NATIVE_${packageJson.version}.auto-speed-suppressed.json` }
    }
  };
}

function addCheck(checks, name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
}

function hasEvery(actual, required) {
  const values = new Set(Array.isArray(actual) ? actual : []);
  return required.every((item) => values.has(item));
}

function validIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validLog(commandResult) {
  if (typeof commandResult?.logPath !== 'string' || !commandResult.logPath.startsWith('.validation/wr01/logs/')) return false;
  const absolute = path.resolve(root, commandResult.logPath);
  const relativeToValidation = path.relative(validationRoot, absolute);
  if (relativeToValidation.startsWith('..') || path.isAbsolute(relativeToValidation) || !fs.existsSync(absolute)) return false;
  const bytes = fs.readFileSync(absolute);
  return bytes.length === commandResult.outputBytes && sha256(bytes) === commandResult.outputSha256;
}

function validateReport(report, digests = currentDigests()) {
  const checks = [];
  addCheck(checks, 'report schema is executable WR-01 acceptance v2', report?.schema === 'aegos.wr01.acceptance/v2');
  addCheck(checks, 'report has a stable validation run ID', typeof report?.validationRunId === 'string' && /^[A-Za-z0-9._-]{8,128}$/.test(report.validationRunId));
  addCheck(checks, 'report records a valid UTC interval', validIso(report?.startedAt) && validIso(report?.finishedAt) && Date.parse(report.finishedAt) >= Date.parse(report.startedAt));
  addCheck(checks, 'report version matches current package', report?.productVersion === packageJson.version, report?.productVersion || 'missing');
  addCheck(checks, 'report records current Git and dirty-worktree identity', /^[0-9a-f]{40}$/i.test(report?.git?.head || '') && typeof report?.git?.dirty === 'boolean' && /^[0-9a-f]{64}$/i.test(report?.git?.worktreeStatusSha256 || ''));
  addCheck(checks, 'report records Windows and toolchain identity', report?.host?.platform === 'win32' && typeof report?.host?.release === 'string' && typeof report?.toolchains?.node === 'string' && typeof report?.toolchains?.rustc === 'string' && typeof report?.toolchains?.cargo === 'string');
  addCheck(checks, 'report keeps the shared-host side-effect boundary', report?.hostSideEffectBoundary === boundary, report?.hostSideEffectBoundary || 'missing');
  addCheck(checks, 'report source digest matches current inputs', report?.sourceInputDigest === digests.source.digest, report?.sourceInputDigest || 'missing');
  addCheck(checks, 'report gate digest matches current inputs', report?.gateInputDigest === digests.gate.digest, report?.gateInputDigest || 'missing');
  addCheck(checks, 'report baseline digest matches the immutable matrix', report?.baselineDigest === digests.baseline, report?.baselineDigest || 'missing');

  const matrix = report?.matrix || {};
  addCheck(checks, 'Rust matrix keeps the floor', Number(matrix.rust?.discovered) >= baseline.rust.discoveredAtLeast && Number(matrix.rust?.failed) === 0 && Number(matrix.rust?.ignored) === 0, JSON.stringify(matrix.rust || {}));
  addCheck(checks, 'UI matrix keeps every required page', hasEvery(matrix.ui?.pages, requiredUiPages));
  addCheck(checks, 'UI matrix keeps all 14 configurations', hasEvery(matrix.ui?.viewports, requiredViewports));
  addCheck(checks, 'performance matrix keeps its floors', matrix.perf?.ok === true && Number(matrix.perf?.nodeCount) >= 800 && Number(matrix.perf?.navigationCount) >= 420, JSON.stringify(matrix.perf || {}));
  addCheck(checks, 'soak matrix keeps at least 16 cycles', matrix.soak?.ok === true && Number(matrix.soak?.cycles) >= 16, JSON.stringify(matrix.soak || {}));
  addCheck(checks, 'product journey evidence is clean', matrix.product?.ok === true && Number(matrix.product?.journeys) >= 12 && matrix.product?.missingJourneys?.length === 0 && matrix.product?.residualTestRoots?.length === 0, JSON.stringify(matrix.product || {}));
  addCheck(checks, 'native enabled and suppressed evidence passed', matrix.native?.enabled?.ok === true && matrix.native?.suppressed?.ok === true, JSON.stringify(matrix.native || {}));

  const commandRows = Array.isArray(report?.commands) ? report.commands : [];
  addCheck(checks, 'required command count is exact and not double-counted', commandRows.length === requiredCommands.length && new Set(commandRows.map((item) => item.id)).size === requiredCommands.length && new Set(commandRows.map((item) => item.command)).size === requiredCommands.length, String(commandRows.length));
  const commands = new Map(commandRows.map((item) => [item?.id, item]));
  for (const required of requiredCommands) {
    const observed = commands.get(required.id);
    const validExecution = observed?.command === required.command
      && observed?.executionStatus === 'executed'
      && Number(observed?.exitCode) === 0
      && validIso(observed?.startedAt)
      && validIso(observed?.finishedAt)
      && Date.parse(observed.finishedAt) >= Date.parse(observed.startedAt)
      && Number(observed?.durationMs) >= 0
      && observed?.sourceInputDigest === report?.sourceInputDigest
      && observed?.gateInputDigest === report?.gateInputDigest
      && observed?.postSourceInputDigest === report?.sourceInputDigest
      && observed?.postGateInputDigest === report?.gateInputDigest
      && validLog(observed);
    addCheck(checks, `required command has verified execution evidence: ${required.id}`, validExecution, observed ? `${observed.command} exit=${observed.exitCode}` : 'missing');
  }

  const findings = Array.isArray(report?.findings) ? report.findings : [];
  addCheck(checks, 'finding register is complete and has unique IDs', hasEvery(findings.map((item) => item.id), expectedFindings) && findings.length === expectedFindings.length && new Set(findings.map((item) => item.id)).size === expectedFindings.length);
  const unresolvedCritical = findings.filter((finding) => ['P0', 'P1'].includes(finding?.severity) && !['repaired', 'deferred_by_user'].includes(finding?.status));
  addCheck(checks, 'no P0/P1 finding remains open', unresolvedCritical.length === 0, unresolvedCritical.map((item) => `${item.id}:${item.status}`).join(', ') || 'none');
  return { ok: checks.every((check) => check.ok), checks, digests };
}

function resultFor(report, reportPath) {
  const result = validateReport(report);
  return {
    ok: result.ok,
    schema: 'aegos.wr01.acceptance/result-v2',
    report: relative(reportPath),
    validationRunId: report?.validationRunId || null,
    sourceInputDigest: result.digests.source.digest,
    gateInputDigest: result.digests.gate.digest,
    baselineDigest: result.digests.baseline,
    failed: result.checks.filter((check) => !check.ok),
    passed: result.checks.filter((check) => check.ok),
    generatedAt: new Date().toISOString()
  };
}

function resolveReportPath(argument) {
  const candidate = argument ? path.resolve(root, argument) : defaultReportPath;
  const relativeToValidation = path.relative(validationRoot, candidate);
  if (relativeToValidation.startsWith('..') || path.isAbsolute(relativeToValidation)) throw new Error('Acceptance reports must stay under .validation/.');
  return candidate;
}

function readReport(reportPath) {
  if (!fs.existsSync(reportPath)) return { error: `Acceptance report is missing: ${relative(reportPath)}` };
  try { return { report: JSON.parse(fs.readFileSync(reportPath, 'utf8')) }; }
  catch (error) { return { error: `Acceptance report is invalid JSON: ${error.message}` }; }
}

function writeReport(reportPath, report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function executeCommand(definition, runId, digests) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const logPath = path.join(wr01Root, 'logs', runId, `${definition.id}.log`);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const fd = fs.openSync(logPath, 'w');
    const hasher = crypto.createHash('sha256');
    let outputBytes = 0;
    const append = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      fs.writeSync(fd, bytes);
      hasher.update(bytes);
      outputBytes += bytes.length;
    };
    console.log(`[WR-01] START ${definition.id}: ${definition.command}`);
    const child = spawn(definition.executable, definition.args, { cwd: root, env: { ...process.env, TAURI_SKIP_UPDATE_CHECK: 'true' }, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', append);
    child.on('close', (code, signal) => {
      fs.closeSync(fd);
      const postDigests = currentDigests();
      const result = {
        id: definition.id,
        command: definition.command,
        executionStatus: 'executed',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        exitCode: Number.isInteger(code) ? code : -1,
        signal: signal || null,
        sourceInputDigest: digests.source.digest,
        gateInputDigest: digests.gate.digest,
        postSourceInputDigest: postDigests.source.digest,
        postGateInputDigest: postDigests.gate.digest,
        logPath: relative(logPath),
        outputBytes,
        outputSha256: hasher.digest('hex')
      };
      const inputsStable = result.postSourceInputDigest === result.sourceInputDigest && result.postGateInputDigest === result.gateInputDigest;
      if (!inputsStable && result.exitCode === 0) result.exitCode = 3;
      console.log(`[WR-01] ${result.exitCode === 0 ? 'PASS' : 'FAIL'} ${definition.id} (${result.durationMs} ms)`);
      resolve(result);
    });
  });
}

function findingRegister() {
  return [
    { id: 'WR01-001', severity: 'P2', status: 'repaired' },
    { id: 'WR01-002', severity: 'limit', status: 'untested' },
    { id: 'WR01-003', severity: 'P1', status: 'repaired' },
    { id: 'WR01-004', severity: 'P1', status: 'repaired' },
    { id: 'WR01-005', severity: 'P2', status: 'repaired' },
    { id: 'WR01-006', severity: 'P3', status: 'repaired' },
    { id: 'WR01-007', severity: 'P1', status: 'repaired' }
  ];
}

async function runMatrix(reportPath) {
  const digests = currentDigests();
  const startedAt = new Date().toISOString();
  const runId = `wr01-${startedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}-${process.pid}`;
  const report = {
    schema: 'aegos.wr01.acceptance/v2',
    validationRunId: runId,
    productVersion: packageJson.version,
    startedAt,
    finishedAt: null,
    sourceInputDigest: digests.source.digest,
    gateInputDigest: digests.gate.digest,
    baselineDigest: digests.baseline,
    git: gitIdentity(),
    host: { platform: process.platform, release: os.release(), arch: process.arch },
    toolchains: { node: process.version, rustc: commandValue('rustc', ['-V']), cargo: commandValue('cargo', ['-V']) },
    hostSideEffectBoundary: boundary,
    matrix: {},
    commands: [],
    findings: findingRegister()
  };
  writeReport(reportPath, report);
  for (const definition of requiredCommands) {
    const result = await executeCommand(definition, runId, digests);
    report.commands.push(result);
    report.finishedAt = new Date().toISOString();
    writeReport(reportPath, report);
    if (result.exitCode !== 0) break;
  }
  if (report.commands.length === requiredCommands.length && report.commands.every((item) => item.exitCode === 0)) {
    report.matrix = deriveMatrix(report.commands);
  }
  report.finishedAt = new Date().toISOString();
  writeReport(reportPath, report);
  const result = resultFor(report, reportPath);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}

function validReportFixture(digests, fixtureRoot) {
  const now = new Date().toISOString();
  const runId = `fixture-${process.pid}`;
  const commands = requiredCommands.map((item) => {
    const logPath = path.join(fixtureRoot, `${item.id}.log`);
    const bytes = Buffer.from(`executed ${item.command}\n`);
    fs.writeFileSync(logPath, bytes);
    return { id: item.id, command: item.command, executionStatus: 'executed', startedAt: now, finishedAt: now, durationMs: 0, exitCode: 0, signal: null, sourceInputDigest: digests.source.digest, gateInputDigest: digests.gate.digest, postSourceInputDigest: digests.source.digest, postGateInputDigest: digests.gate.digest, logPath: relative(logPath), outputBytes: bytes.length, outputSha256: sha256(bytes) };
  });
  return {
    schema: 'aegos.wr01.acceptance/v2', validationRunId: runId, productVersion: packageJson.version,
    startedAt: now, finishedAt: now, sourceInputDigest: digests.source.digest, gateInputDigest: digests.gate.digest,
    baselineDigest: digests.baseline, git: { head: '0'.repeat(40), dirty: true, worktreeStatusSha256: '1'.repeat(64) },
    host: { platform: 'win32', release: 'fixture', arch: 'x64' }, toolchains: { node: 'node fixture', rustc: 'rustc fixture', cargo: 'cargo fixture' },
    hostSideEffectBoundary: boundary,
    matrix: { rust: { discovered: 224, failed: 0, ignored: 0 }, ui: { pages: requiredUiPages, viewports: requiredViewports }, perf: { nodeCount: 800, navigationCount: 420, ok: true }, soak: { cycles: 16, ok: true }, product: { journeys: 12, missingJourneys: [], residualTestRoots: [], ok: true }, native: { enabled: { ok: true }, suppressed: { ok: true } } },
    commands, findings: findingRegister()
  };
}

function selfTest() {
  const fixtureRoot = path.join(wr01Root, 'logs', `self-test-${process.pid}`);
  fs.mkdirSync(fixtureRoot, { recursive: true });
  const tests = [];
  try {
    const digests = currentDigests();
    const valid = validReportFixture(digests, fixtureRoot);
    const validResult = validateReport(valid, digests);
    tests.push({ name: 'valid executable fixture passes', ok: validResult.ok, detail: validResult.checks.filter((check) => !check.ok) });
    const stale = structuredClone(valid); stale.gateInputDigest = '0'.repeat(64);
    tests.push({ name: 'stale gate digest is rejected', ok: !validateReport(stale, digests).ok });
    const reduced = structuredClone(valid); reduced.matrix.ui.viewports = reduced.matrix.ui.viewports.slice(1);
    tests.push({ name: 'reduced UI matrix is rejected', ok: !validateReport(reduced, digests).ok });
    const missing = structuredClone(valid); missing.commands = missing.commands.filter((item) => item.id !== 'cargo-test');
    tests.push({ name: 'missing required command is rejected', ok: !validateReport(missing, digests).ok });
    const duplicate = structuredClone(valid); duplicate.commands[1].command = duplicate.commands[0].command;
    tests.push({ name: 'duplicate command evidence is rejected', ok: !validateReport(duplicate, digests).ok });
    const forged = structuredClone(valid); forged.commands[0].executionStatus = 'declared';
    tests.push({ name: 'declared zero exit without execution is rejected', ok: !validateReport(forged, digests).ok });
    const missingLog = structuredClone(valid); missingLog.commands[0].logPath = '.validation/wr01/logs/missing.log';
    tests.push({ name: 'missing command log is rejected', ok: !validateReport(missingLog, digests).ok });
    const tamperedLog = structuredClone(valid); fs.appendFileSync(path.join(root, tamperedLog.commands[0].logPath), 'tampered');
    tests.push({ name: 'tampered command log is rejected', ok: !validateReport(tamperedLog, digests).ok });
    const missingIdentity = structuredClone(valid); delete missingIdentity.git.worktreeStatusSha256;
    tests.push({ name: 'missing run identity is rejected', ok: !validateReport(missingIdentity, digests).ok });
    const midRunDrift = structuredClone(valid); midRunDrift.commands[0].postSourceInputDigest = 'f'.repeat(64);
    tests.push({ name: 'mid-run input drift is rejected', ok: !validateReport(midRunDrift, digests).ok });
    const openP1 = structuredClone(valid); openP1.findings.find((item) => item.id === 'WR01-003').status = 'open';
    tests.push({ name: 'open P1 is rejected', ok: !validateReport(openP1, digests).ok });
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
  const result = { ok: tests.every((test) => test.ok), tests, generatedAt: new Date().toISOString() };
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}

const reportArgument = process.argv.find((item) => item.startsWith('--report='))?.slice('--report='.length);
const reportPath = resolveReportPath(reportArgument);
if (process.argv.includes('--self-test')) selfTest();
else if (process.argv.includes('--run')) await runMatrix(reportPath);
else if (process.argv.includes('--print-schema')) console.log(JSON.stringify({ schema: 'aegos.wr01.acceptance/v2', baseline, ...currentDigests(), gateInputs: gateFiles }, null, 2));
else {
  const loaded = readReport(reportPath);
  if (loaded.error) {
    console.log(JSON.stringify({ ok: false, error: loaded.error, generatedAt: new Date().toISOString() }, null, 2));
    process.exit(2);
  }
  const result = resultFor(loaded.report, reportPath);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}
