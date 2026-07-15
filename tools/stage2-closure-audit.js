import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok: Boolean(ok), detail });
}

const pkg = JSON.parse(read('package.json'));
const releaseAudit = read('tools/release-audit.js');
const stageRelease = exists(`RELEASE_${pkg.version}.md`) ? read(`RELEASE_${pkg.version}.md`) : '';
const runtimeGate = read('tools/runtime-regression-gate-audit.js');
const takeoverAudit = read('tools/system-takeover-audit.js');
const backendAudit = read('tools/backend-audit.js');
const diagnosticsAudit = read('tools/diagnostics-logs-audit.js');
const securityAudit = read('tools/security-hotfix-audit.js');
const coreRuntimeAudit = read('tools/core-runtime-audit.js');
const installerAudit = read('tools/installer-regression-audit.js');

const stage2Scripts = {
  'audit:runtime-regression': 'node tools/runtime-regression-gate-audit.js',
  'audit:installer-regression': 'node tools/installer-regression-audit.js',
  'audit:takeover': 'node tools/system-takeover-audit.js',
  'audit:backend': 'node tools/backend-audit.js',
  'audit:diagnostics': 'node tools/diagnostics-logs-audit.js',
  'audit:security': 'node tools/security-hotfix-audit.js',
  'audit:core-runtime': 'node tools/core-runtime-audit.js',
  'audit:release': 'node tools/release-audit.js',
  'audit:stage2-closure': 'node tools/stage2-closure-audit.js'
};

for (const [script, command] of Object.entries(stage2Scripts)) {
  check(`package exposes ${script}`, pkg.scripts?.[script] === command, command);
}

check(
  'release audit knows the stage 2 closure gate',
  releaseAudit.includes('stage 2 closure audit script exists') &&
    releaseAudit.includes('tools/stage2-closure-audit.js') &&
    releaseAudit.includes('audit:stage2-closure'),
  'tools/release-audit.js'
);

check(
  'stage 2 gate depends on the runtime regression gate instead of duplicating narrow checks',
  runtimeGate.includes('runtime gate keeps the known responsiveness regressions visible') &&
    runtimeGate.includes('runtime gate keeps system takeover and firewall regressions visible') &&
    runtimeGate.includes('runtime gate keeps diagnostics and log redaction visible'),
  'tools/runtime-regression-gate-audit.js'
);

check(
  'stage 2 keeps system proxy takeover transaction coverage visible',
    takeoverAudit.includes('Windows proxy takeover snapshots and restores previous state') &&
    takeoverAudit.includes('Windows proxy takeover integrity has one shared diagnostic contract') &&
    takeoverAudit.includes('manual system proxy preference does not auto-connect traffic takeover') &&
    takeoverAudit.includes('settings updates validate before save and roll back after failed side effects'),
  'tools/system-takeover-audit.js'
);

check(
  'stage 2 keeps stale async result guards visible',
  backendAudit.includes('outbound IP refresh ignores stale node results') &&
    backendAudit.includes('old outbound IP lookups must not overwrite cache after node/profile changes') &&
    backendAudit.includes('subscription and outbound IP jobs reduce core lock scope'),
  'tools/backend-audit.js'
);

check(
  'stage 2 keeps diagnostics action and redaction coverage visible',
  diagnosticsAudit.includes('diagnostic report includes summary, details, hints, and copy UI') &&
    diagnosticsAudit.includes('support export for user support and diagnostics') &&
    diagnosticsAudit.includes('diagnostics does expensive work outside the CoreManager lock'),
  'tools/diagnostics-logs-audit.js'
);

check(
  'stage 2 keeps security hotfix coverage visible',
  securityAudit.includes('logs and public subscription metadata are sanitized') &&
    securityAudit.includes('subscription token/password/uuid/bearer/userinfo must not leak through logs or public profile JSON') &&
    securityAudit.includes('controller must bind locally, allow-lan must be opt-in, and secret must be generated'),
  'tools/security-hotfix-audit.js'
);

check(
  'stage 2 keeps core boundary ownership visible',
  coreRuntimeAudit.includes('Aegos applies runtime profiles through an audited core runtime transaction') &&
    coreRuntimeAudit.includes('disconnect protection firewall policy is owned by the core runtime boundary') &&
    coreRuntimeAudit.includes('system proxy takeover plan is owned by the core runtime boundary'),
  'tools/core-runtime-audit.js'
);

check(
  'stage 2 keeps installer regression recovery coverage visible',
  installerAudit.includes('checklist covers network restoration') &&
    installerAudit.includes('checklist covers UI responsiveness') &&
    installerAudit.includes('package version keeps installer regression gate after 2.9.57'),
  'tools/installer-regression-audit.js'
);

check(
  'current release records second-stage closure verification',
  stageRelease.includes('npm run audit:stage2-closure') &&
    stageRelease.includes('npm run audit:runtime-regression') &&
    stageRelease.includes('npm run audit:takeover') &&
    stageRelease.includes('cargo check --manifest-path src-tauri/Cargo.toml'),
  `RELEASE_${pkg.version}.md`
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
