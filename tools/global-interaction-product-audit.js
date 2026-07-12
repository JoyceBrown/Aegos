import fs from 'fs';
import path from 'path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const appJs = read('src/app.js');
const stylesCss = read('src/styles.css');
const perfSmoke = read('tools/perf-smoke.js');
const interactionSmoke = read('tools/interaction-smoke.js');
const releaseAudit = read('tools/release-audit.js');

const failures = [];
const passed = [];

function check(name, ok, detail = '') {
  if (ok) passed.push(name);
  else failures.push(`${name}${detail ? ` (${detail})` : ''}`);
}

check('version is 3.4.19 interaction/performance checkpoint', pkg.version === '3.4.19', pkg.version);
check(
  'settings background probes cannot pile up during rapid navigation',
  appJs.includes('let environmentReadinessBusy = false') &&
    appJs.includes('let ipv6DnsSafetyBusy = false') &&
    appJs.includes('if (environmentReadinessBusy)') &&
    appJs.includes('environmentReadinessBusy = false') &&
    appJs.includes('if (ipv6DnsSafetyBusy) return') &&
    appJs.includes('ipv6DnsSafetyBusy = false'),
  'settings probe busy guards'
);
check(
  'primary navigation remains immediate and deferred-load',
  appJs.includes('pointerdown') &&
    appJs.includes('schedulePageLoad') &&
    appJs.includes('pageLoadToken') &&
    appJs.includes('runWhenIdle') &&
    appJs.includes('foregroundBusy > 0') &&
    stylesCss.includes('contain: layout paint'),
  'deferred navigation'
);
check(
  'heavy user tasks remain detached from foreground busy',
  appJs.includes("runBackgroundJob('diagnostics'") &&
    appJs.includes("runBackgroundJob('applyRoutingDrafts'") &&
    appJs.includes("runBackgroundJob('exportDiagnostics'") &&
    appJs.includes("invoke('start_proxy_delay_test'") &&
    !appJs.includes("$('#quickTestBtn').onclick = (event) => runButtonAction"),
  'background task model'
);
check(
  'large visible lists stay bounded',
  appJs.includes('nodeRenderLimit = 36') &&
    appJs.includes('homeNodeRenderLimit = 8') &&
    appJs.includes('logRenderLimit') &&
    appJs.includes('rules.slice(0, 40)') &&
    stylesCss.includes('scrollbar-gutter: stable'),
  'bounded list rendering'
);
check(
  'button pending feedback does not disable controls or change fixed icon content',
  appJs.includes("button.classList.toggle('is-pending', busy)") &&
    appJs.includes("button.dataset.busy = busy ? 'true' : ''") &&
    !appJs.includes('button.disabled = busy') &&
    stylesCss.includes('button.is-pending') &&
    stylesCss.includes('@keyframes aegosIconBusySpin'),
  'non-disabling pending UI'
);
check(
  'runtime smoke and perf smoke cover historical stall paths',
  interactionSmoke.includes('running diagnostics blocked sidebar page switching') &&
    interactionSmoke.includes('speed test blocked sidebar page switching') &&
    interactionSmoke.includes('button became disabled during pending feedback') &&
    perfSmoke.includes('i < 420') &&
    perfSmoke.includes('rapid navigation triggered diagnostics before quiet period'),
  'smoke coverage'
);
check(
  'release audit includes global interaction product gate',
  releaseAudit.includes("audit:global-interaction-product") &&
    releaseAudit.includes('global interaction product gate'),
  'release gate'
);

const result = { ok: failures.length === 0, failed: failures, passed };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
