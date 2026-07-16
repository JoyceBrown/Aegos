import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const pkg = JSON.parse(read('package.json'));
const checkpointVersion = '3.6.31';
const evidenceVersion = pkg.version;
const evidenceFile = `PRODUCT_SMOKE_${evidenceVersion}.json`;
const evidence = exists(evidenceFile) ? JSON.parse(read(evidenceFile)) : null;
const interaction = read('tools/interaction-smoke.js');
const mainline = read('CURRENT_MAINLINE_3.5.71_TO_3.6.40.md');
const release = exists(`RELEASE_${evidenceVersion}.md`) ? read(`RELEASE_${evidenceVersion}.md`) : '';
const releaseAudit = read('tools/release-audit.js');
const failures = [];
const passed = [];
const requiredJourneys = [
  'startupTruth', 'tunOffConnection', 'tunOnConnection', 'measurementOnlySpeed',
  'nodeAndOutboundIp', 'subscriptionLifecycle', 'routingRuleLifecycle',
  'diagnosticsRepairAndExport', 'settingsAndEnvironment', 'nonBlockingBackgroundWork'
];

function check(name, condition, detail = '') {
  (condition ? passed : failures).push({ name, detail });
}

check('3.6.31 product-smoke evidence remains carried forward', Number(pkg.version.split('.')[2] || 0) >= 31, pkg.version);
check('product smoke executes the browser interaction journey', pkg.scripts?.['smoke:product'] === 'node tools/product-journey-smoke.js' && exists('tools/product-journey-smoke.js'));
check('runtime product-smoke evidence exists', Boolean(evidence), evidenceFile);
check('runtime evidence belongs to the current source version', evidence?.version === evidenceVersion, `${evidence?.version || '-'} / ${evidenceVersion}`);
check('all ordinary-user journeys passed', requiredJourneys.every((name) => evidence?.journeys?.[name] === true), requiredJourneys.filter((name) => evidence?.journeys?.[name] !== true).join(', '));
check('forbidden side effects stayed at zero', evidence && Object.values(evidence.forbiddenSideEffects || {}).every((count) => Number(count) === 0), JSON.stringify(evidence?.forbiddenSideEffects || {}));
check('journey returned complete command evidence', evidence?.ok === true && Number(evidence?.commandCount || 0) > 20 && !(evidence?.missingCommands || []).length && !(evidence?.missingJobKinds || []).length, `${evidence?.commandCount || 0} commands`);
check('TUN-off and TUN-on connection paths are distinct in interaction smoke', interaction.includes('TUN-on connection did not reach connected state') && interaction.includes('connected TUN-off system proxy metric'));
check('rules are previewed, verified, and safely applied', interaction.includes('verifyAllRoutingDraftsBtn') && interaction.includes('applyRoutingDraftsBtn') && interaction.includes("args.kind === 'applyRoutingDrafts'"));
check('environment readiness is a rendered user path', interaction.includes("command === 'environment_readiness'") && interaction.includes('environment readiness did not render actionable checks'));
check('mainline defines every Stage 8 checkpoint', Array.from({ length: 10 }, (_, index) => `3.6.${31 + index}`).every((version) => mainline.includes(version)));
check('release records scope and real limitations', release.includes('complete product smoke') && release.includes('Real airport connectivity') && release.includes('npm run smoke:product'));
check('Stage 8 gate is exposed and known by release audit', pkg.scripts?.['audit:stage8-product-smoke'] === 'node tools/stage8-product-smoke-audit.js' && releaseAudit.includes('stage 8 product smoke gate'));

const result = { ok: failures.length === 0, failed: failures, passed, evidence: evidenceFile, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
