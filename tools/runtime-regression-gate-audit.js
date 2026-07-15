import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

const pkg = JSON.parse(read('package.json'));
const releaseAudit = read('tools/release-audit.js');
const stageRelease = exists(`RELEASE_${pkg.version}.md`) ? read(`RELEASE_${pkg.version}.md`) : '';
const installerChecklist = exists('installer-regression-checklist.md') ? read('installer-regression-checklist.md') : '';
const stabilityAudit = read('tools/stability-regression-audit.js');
const backendAudit = read('tools/backend-audit.js');
const coreRuntimeAudit = read('tools/core-runtime-audit.js');
const takeoverAudit = read('tools/system-takeover-audit.js');
const diagnosticsAudit = read('tools/diagnostics-logs-audit.js');
const securityAudit = read('tools/security-hotfix-audit.js');

const requiredScripts = {
  'audit:backend': 'node tools/backend-audit.js',
  'audit:stability': 'node tools/stability-regression-audit.js',
  'audit:core-runtime': 'node tools/core-runtime-audit.js',
  'audit:diagnostics': 'node tools/diagnostics-logs-audit.js',
  'audit:security': 'node tools/security-hotfix-audit.js',
  'audit:takeover': 'node tools/system-takeover-audit.js',
  'audit:installer-regression': 'node tools/installer-regression-audit.js',
  'audit:release': 'node tools/release-audit.js',
  'audit:runtime-regression': 'node tools/runtime-regression-gate-audit.js'
};

const pass = [];
const fail = [];

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok: Boolean(ok), detail });
}

for (const [script, command] of Object.entries(requiredScripts)) {
  check(`package exposes ${script}`, pkg.scripts?.[script] === command, command);
}

check(
  'release audit knows the runtime regression gate',
  releaseAudit.includes('runtime regression gate audit script exists') &&
    releaseAudit.includes('tools/runtime-regression-gate-audit.js') &&
    releaseAudit.includes('audit:runtime-regression'),
  'release-audit.js'
);

check(
  'runtime gate keeps the known responsiveness regressions visible',
  stabilityAudit.includes('speed test UI does not use foreground busy') &&
    stabilityAudit.includes('diagnostics stays explicit, detached, and navigation-safe') &&
    stabilityAudit.includes('profile switching cancels stale speed work') &&
    backendAudit.includes('outbound IP refresh ignores stale node results'),
  'speed/diagnostics/profile/outbound IP'
);

check(
  'runtime gate keeps system takeover and firewall regressions visible',
  takeoverAudit.includes('Windows proxy takeover integrity has one shared diagnostic contract') &&
    takeoverAudit.includes('speed tests can run under disconnect protection through scoped temporary allow rules') &&
    coreRuntimeAudit.includes('disconnect protection firewall policy is owned by the core runtime boundary'),
  'proxy takeover/firewall'
);

check(
  'runtime gate keeps diagnostics and log redaction visible',
  diagnosticsAudit.includes('diagnostic report includes summary, details, hints, and copy UI') &&
    diagnosticsAudit.includes('fn redact_sensitive_ip_literals') &&
    securityAudit.includes('fn redact_windows_local_paths') &&
    securityAudit.includes('fn redact_sensitive_ip_literals'),
  'diagnostics/redaction'
);

check(
  'installer regression checklist remains tied to runtime recovery',
  installerChecklist.includes('Disconnect restores previous system proxy') &&
    installerChecklist.includes('Disconnect protection close cleans firewall rules') &&
    installerChecklist.includes('Rapid navigation does not freeze') &&
    installerChecklist.includes('audit:release'),
  'installer-regression-checklist.md'
);

check(
  'current release records runtime regression gate verification',
  stageRelease.includes('npm run audit:runtime-regression') &&
    stageRelease.includes('npm run audit:installer-regression') &&
    stageRelease.includes('npm run audit:stability') &&
    stageRelease.includes('npm run audit:core-runtime'),
  `RELEASE_${pkg.version}.md`
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
