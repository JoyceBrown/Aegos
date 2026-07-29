import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, '.validation', 'wr01', 'candidate-provenance.json');
const acceptancePath = path.join(root, '.validation', 'wr01', 'acceptance.json');
const payloadReportPath = path.join(root, '.validation', 'lic01', 'payload-audit.json');
const currentVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const productRoots = [
  'src', 'src-tauri/src', 'src-tauri/capabilities', 'src-tauri/icons',
  'third_party/mihomo', 'third_party/fluent-ui-system-icons', 'third_party/rust'
];
// Keep this input boundary identical to WR-01 acceptance. A candidate cannot be
// source-bound if its provenance digest is computed from a different file set.
const productFiles = [
  'package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock',
  'src-tauri/tauri.conf.json', 'resources/core/mihomo.exe', 'LICENSE', 'THIRD_PARTY_NOTICES.md'
];
const gateFiles = [
  'AGENTS.md', 'PLANS.md', 'README.md', `RELEASE_${currentVersion}.md`, 'package.json',
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
const targetTriple = 'x86_64-pc-windows-msvc';
const configOverlay = 'default';
const licenseGates = ['audit:licenses', 'audit:licenses-fixtures'];

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function collect(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return [];
  if (fs.statSync(absolute).isFile()) return [relative.replaceAll('\\', '/')];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => collect(path.join(relative, entry.name)));
}

function inputDigest(paths) {
  const records = [...new Set(paths)].sort().map((relative) => {
    const file = path.join(root, relative);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('required input is missing: ' + relative);
    const bytes = fs.readFileSync(file);
    return { path: relative.replaceAll('\\', '/'), bytes: bytes.length, sha256: digest(bytes) };
  });
  const acceptanceRecords = records.map((record) => ({
    file: record.path,
    size: record.bytes,
    sha256: record.sha256
  }));
  return { digest: digest(JSON.stringify(acceptanceRecords)), records };
}

function currentInputs() {
  return {
    product: inputDigest([...productRoots.flatMap(collect), ...productFiles]),
    gate: inputDigest(gateFiles),
  };
}

function version() {
  return currentVersion;
}

function artifactPath() {
  return 'src-tauri/target/release/bundle/nsis/Aegos_' + version() + '_x64-setup.exe';
}

function commandValue(command, args) {
  const result = childProcess.spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : 'unavailable';
}

function artifactIdentity(relative = artifactPath()) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) return { path: relative, exists: false, bytes: null, sha256: null };
  const bytes = fs.readFileSync(file);
  return { path: relative, exists: true, bytes: bytes.length, sha256: digest(bytes) };
}

function validIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function acceptanceIdentity() {
  if (!fs.existsSync(acceptancePath)) {
    return { path: '.validation/wr01/acceptance.json', exists: false, valid: false };
  }
  const bytes = fs.readFileSync(acceptancePath);
  let report = null;
  try { report = JSON.parse(bytes.toString('utf8')); } catch { report = null; }
  const checked = childProcess.spawnSync(process.execPath, ['tools/wr01-acceptance.js'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  });
  return {
    path: '.validation/wr01/acceptance.json',
    exists: true,
    valid: checked.status === 0,
    sha256: digest(bytes),
    validationRunId: report?.validationRunId || null,
    sourceInputDigest: report?.sourceInputDigest || null,
    gateInputDigest: report?.gateInputDigest || null
  };
}

function payloadIdentity(artifact = artifactIdentity()) {
  if (!fs.existsSync(payloadReportPath)) {
    return { path: '.validation/lic01/payload-audit.json', exists: false, valid: false };
  }
  const bytes = fs.readFileSync(payloadReportPath);
  let report = null;
  try { report = JSON.parse(bytes.toString('utf8')); } catch { report = null; }
  const valid = report?.schema === 'aegos.installer-payload-audit/v1'
    && report?.ok === true
    && report?.productVersion === version()
    && report?.installer?.path === artifact.path
    && report?.installer?.bytes === artifact.bytes
    && report?.installer?.sha256 === artifact.sha256
    && report?.extractionCleaned === true
    && Array.isArray(report?.matches)
    && report.matches.length === 9
    && report.matches.every((item) => item?.ok === true);
  return {
    path: '.validation/lic01/payload-audit.json',
    exists: true,
    valid,
    sha256: digest(bytes),
    installerSha256: report?.installer?.sha256 || null,
    matchedResources: Array.isArray(report?.matches) ? report.matches.length : 0
  };
}

function identifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(value);
}

function validate(manifest, context = {}) {
  const inputs = context.inputs || currentInputs();
  const artifact = context.artifact || artifactIdentity();
  const acceptance = context.acceptance || acceptanceIdentity();
  const payload = context.payload || payloadIdentity(artifact);
  const checks = [];
  const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });
  check('schema', manifest?.schema === 'aegos.wr01.candidate-provenance/v2');
  check('version', manifest?.version === version());
  check('validation and build IDs are valid', identifier(manifest?.validationRunId) && identifier(manifest?.buildId));
  check('UTC interval is valid', validIso(manifest?.startedAt) && validIso(manifest?.finishedAt) && Date.parse(manifest.finishedAt) >= Date.parse(manifest.startedAt));
  check('target is the Windows candidate target', manifest?.targetTriple === targetTriple);
  check('config overlay is explicit', manifest?.configOverlay === configOverlay);
  check('build command is recorded', typeof manifest?.buildCommand === 'string' && manifest.buildCommand.startsWith('npm run build'));
  check('toolchains are recorded', typeof manifest?.toolchains?.node === 'string' && typeof manifest?.toolchains?.rustc === 'string' && typeof manifest?.toolchains?.cargo === 'string');
  check('Git summary is recorded without host paths', typeof manifest?.git?.head === 'string' && typeof manifest?.git?.dirty === 'boolean');
  check('product digest', manifest?.productInputDigest === inputs.product.digest);
  check('gate digest', manifest?.gateInputDigest === inputs.gate.digest);
  check('product records', JSON.stringify(manifest?.productInputs) === JSON.stringify(inputs.product.records));
  check('gate records', JSON.stringify(manifest?.gateInputs) === JSON.stringify(inputs.gate.records));
  check('license gates are explicitly bound', JSON.stringify(manifest?.licenseGates) === JSON.stringify(licenseGates));
  check('third-party notice digest is bound', manifest?.thirdPartyNotice?.path === 'THIRD_PARTY_NOTICES.md' && manifest?.thirdPartyNotice?.sha256 === inputs.product.records.find((record) => record.path === 'THIRD_PARTY_NOTICES.md')?.sha256);
  check('Mihomo digest is bound', manifest?.mihomo?.path === 'resources/core/mihomo.exe' && manifest?.mihomo?.sha256 === inputs.product.records.find((record) => record.path === 'resources/core/mihomo.exe')?.sha256);
  check('Mihomo provenance digest is bound', manifest?.mihomo?.provenancePath === 'third_party/mihomo/provenance.json' && manifest?.mihomo?.provenanceSha256 === inputs.product.records.find((record) => record.path === 'third_party/mihomo/provenance.json')?.sha256);
  check('artifact path', manifest?.artifact?.path === artifact.path);
  check('artifact exists', artifact.exists);
  check('artifact bytes', manifest?.artifact?.bytes === artifact.bytes);
  check('artifact digest', manifest?.artifact?.sha256 === artifact.sha256);
  check('actual installer payload report is current and valid', payload.exists && payload.valid);
  check('actual installer payload report identity is bound', manifest?.payloadAudit?.path === payload.path && manifest?.payloadAudit?.sha256 === payload.sha256 && manifest?.payloadAudit?.installerSha256 === artifact.sha256 && manifest?.payloadAudit?.matchedResources === 9);
  check('acceptance report is current and valid', acceptance.exists && acceptance.valid);
  check('acceptance report identity is bound', manifest?.acceptance?.path === acceptance.path && manifest?.acceptance?.sha256 === acceptance.sha256 && manifest?.acceptance?.validationRunId === acceptance.validationRunId);
  check('acceptance inputs match the candidate inputs', acceptance.sourceInputDigest === inputs.product.digest && acceptance.gateInputDigest === inputs.gate.digest && manifest?.acceptance?.sourceInputDigest === inputs.product.digest && manifest?.acceptance?.gateInputDigest === inputs.gate.digest);
  return { ok: checks.every((item) => item.ok), checks, inputs, artifact, acceptance, payload };
}

function requiredArgument(name) {
  const prefix = '--' + name + '=';
  const value = process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error('missing required --' + name + '=... for provenance write');
  return value;
}

function write() {
  const inputs = currentInputs();
  const artifact = artifactIdentity();
  const acceptance = acceptanceIdentity();
  const payload = payloadIdentity(artifact);
  if (!artifact.exists) throw new Error('candidate artifact is missing: ' + artifact.path);
  if (!acceptance.valid) throw new Error('current WR-01 acceptance report is missing or invalid');
  if (!payload.valid) throw new Error('current actual installer payload audit is missing or invalid');
  const manifest = {
    schema: 'aegos.wr01.candidate-provenance/v2',
    version: version(),
    validationRunId: requiredArgument('validation-run'),
    buildId: requiredArgument('build-id'),
    startedAt: requiredArgument('started-at'),
    finishedAt: requiredArgument('finished-at'),
    targetTriple,
    configOverlay,
    buildCommand: requiredArgument('build-command'),
    toolchains: { node: process.version, rustc: commandValue('rustc', ['-V']), cargo: commandValue('cargo', ['-V']) },
    git: { head: commandValue('git', ['rev-parse', 'HEAD']), dirty: commandValue('git', ['status', '--porcelain']) !== '' },
    productInputDigest: inputs.product.digest,
    gateInputDigest: inputs.gate.digest,
    productInputs: inputs.product.records,
    gateInputs: inputs.gate.records,
    licenseGates,
    thirdPartyNotice: { path: 'THIRD_PARTY_NOTICES.md', sha256: inputs.product.records.find((record) => record.path === 'THIRD_PARTY_NOTICES.md').sha256 },
    mihomo: {
      path: 'resources/core/mihomo.exe',
      sha256: inputs.product.records.find((record) => record.path === 'resources/core/mihomo.exe').sha256,
      provenancePath: 'third_party/mihomo/provenance.json',
      provenanceSha256: inputs.product.records.find((record) => record.path === 'third_party/mihomo/provenance.json').sha256
    },
    artifact: { path: artifact.path, bytes: artifact.bytes, sha256: artifact.sha256 },
    payloadAudit: {
      path: payload.path,
      sha256: payload.sha256,
      installerSha256: payload.installerSha256,
      matchedResources: payload.matchedResources
    },
    acceptance: {
      path: acceptance.path,
      sha256: acceptance.sha256,
      validationRunId: acceptance.validationRunId,
      sourceInputDigest: acceptance.sourceInputDigest,
      gateInputDigest: acceptance.gateInputDigest
    }
  };
  const checked = validate(manifest, { inputs, artifact, acceptance, payload });
  if (!checked.ok) throw new Error('refusing to write invalid provenance: ' + checked.checks.filter((check) => !check.ok).map((check) => check.name).join(', '));
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function fixtureManifest(inputs, artifact, acceptance, payload) {
  const now = '2026-07-27T00:00:00.000Z';
  return {
    schema: 'aegos.wr01.candidate-provenance/v2', version: version(), validationRunId: 'wr01-fixture-0001', buildId: 'wr01-build-fixture-0001',
    startedAt: now, finishedAt: now, targetTriple, configOverlay, buildCommand: 'npm run build',
    toolchains: { node: 'v24.fixture', rustc: 'rustc fixture', cargo: 'cargo fixture' }, git: { head: 'fixture', dirty: true },
    productInputDigest: inputs.product.digest, gateInputDigest: inputs.gate.digest, productInputs: inputs.product.records, gateInputs: inputs.gate.records,
    licenseGates,
    thirdPartyNotice: { path: 'THIRD_PARTY_NOTICES.md', sha256: inputs.product.records.find((record) => record.path === 'THIRD_PARTY_NOTICES.md').sha256 },
    mihomo: {
      path: 'resources/core/mihomo.exe',
      sha256: inputs.product.records.find((record) => record.path === 'resources/core/mihomo.exe').sha256,
      provenancePath: 'third_party/mihomo/provenance.json',
      provenanceSha256: inputs.product.records.find((record) => record.path === 'third_party/mihomo/provenance.json').sha256
    },
    artifact: { path: artifact.path, bytes: artifact.bytes, sha256: artifact.sha256 },
    payloadAudit: { path: payload.path, sha256: payload.sha256, installerSha256: payload.installerSha256, matchedResources: payload.matchedResources },
    acceptance: {
      path: acceptance.path,
      sha256: acceptance.sha256,
      validationRunId: acceptance.validationRunId,
      sourceInputDigest: acceptance.sourceInputDigest,
      gateInputDigest: acceptance.gateInputDigest
    }
  };
}

function fixture() {
  const before = currentInputs();
  const packageFile = path.join(root, 'package.json');
  const stat = fs.statSync(packageFile);
  fs.utimesSync(packageFile, stat.atime, stat.mtime);
  const after = currentInputs();
  const artifact = { path: artifactPath(), exists: true, bytes: 17, sha256: digest('fixture artifact') };
  const acceptance = { path: '.validation/wr01/acceptance.json', exists: true, valid: true, sha256: digest('fixture acceptance'), validationRunId: 'wr01-fixture-acceptance', sourceInputDigest: before.product.digest, gateInputDigest: before.gate.digest };
  const payload = { path: '.validation/lic01/payload-audit.json', exists: true, valid: true, sha256: digest('fixture payload'), installerSha256: artifact.sha256, matchedResources: 9 };
  const valid = fixtureManifest(before, artifact, acceptance, payload);
  const rejects = (name, mutate) => {
    const candidate = structuredClone(valid);
    mutate(candidate);
    return { name, ok: !validate(candidate, { inputs: before, artifact, acceptance, payload }).ok };
  };
  const tests = [
    { name: 'unchanged fixture passes', ok: validate(valid, { inputs: before, artifact, acceptance, payload }).ok },
    { name: 'mtime-only change preserves digests', ok: before.product.digest === after.product.digest && before.gate.digest === after.gate.digest },
    rejects('one-byte source drift is rejected', (candidate) => { candidate.productInputs[0].sha256 = '0'.repeat(64); }),
    rejects('added product input is rejected', (candidate) => { candidate.productInputs.push({ path: 'src/added.js', bytes: 1, sha256: '0'.repeat(64) }); }),
    rejects('removed product input is rejected', (candidate) => { candidate.productInputs.pop(); }),
    rejects('renamed product input is rejected', (candidate) => { candidate.productInputs[0].path += '.renamed'; }),
    rejects('changed Mihomo is rejected', (candidate) => { candidate.mihomo.sha256 = '0'.repeat(64); }),
    rejects('changed Mihomo provenance is rejected', (candidate) => { candidate.mihomo.provenanceSha256 = '0'.repeat(64); }),
    rejects('changed third-party notice is rejected', (candidate) => { candidate.thirdPartyNotice.sha256 = '0'.repeat(64); }),
    rejects('removed license gate is rejected', (candidate) => { candidate.licenseGates.pop(); }),
    rejects('gate drift is rejected', (candidate) => { candidate.gateInputDigest = '0'.repeat(64); }),
    rejects('wrong version is rejected', (candidate) => { candidate.version = '0.0.0'; }),
    rejects('wrong target is rejected', (candidate) => { candidate.targetTriple = 'aarch64-pc-windows-msvc'; }),
    rejects('wrong overlay is rejected', (candidate) => { candidate.configOverlay = 'debug'; }),
    rejects('invalid build ID is rejected', (candidate) => { candidate.buildId = '../wrong'; }),
    rejects('tampered artifact is rejected', (candidate) => { candidate.artifact.sha256 = 'f'.repeat(64); }),
    rejects('tampered payload audit is rejected', (candidate) => { candidate.payloadAudit.sha256 = 'd'.repeat(64); }),
    rejects('tampered acceptance report is rejected', (candidate) => { candidate.acceptance.sha256 = 'e'.repeat(64); }),
    { name: 'acceptance/product digest boundary mismatch is rejected', ok: !validate(valid, { inputs: before, artifact, acceptance: { ...acceptance, sourceInputDigest: '0'.repeat(64) }, payload }).ok },
    { name: 'acceptance/gate digest boundary mismatch is rejected', ok: !validate(valid, { inputs: before, artifact, acceptance: { ...acceptance, gateInputDigest: '0'.repeat(64) }, payload }).ok },
  ];
  const result = { ok: tests.every((test) => test.ok), tests, generatedAt: new Date().toISOString() };
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}

try {
  if (process.argv.includes('--write')) console.log(JSON.stringify(write(), null, 2));
  else if (process.argv.includes('--self-test')) fixture();
  else {
    if (!fs.existsSync(manifestPath)) throw new Error('current candidate provenance is missing: .validation/wr01/candidate-provenance.json');
    const result = validate(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 2);
  }
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(2);
}
