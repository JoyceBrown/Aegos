import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const interactionSmoke = path.join(root, 'tools', 'interaction-smoke.js');
const evidencePath = path.join(root, `PRODUCT_SMOKE_${pkg.version}.json`);
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

const missingJourneys = requiredJourneys.filter((name) => interaction?.journeys?.[name] !== true);
const forbiddenSideEffects = Object.entries(interaction?.forbiddenSideEffects || {})
  .filter(([, count]) => Number(count) !== 0)
  .map(([name, count]) => ({ name, count }));
const ok = child.status === 0 && interaction?.ok === true && missingJourneys.length === 0 && forbiddenSideEffects.length === 0;
const evidence = {
  ok,
  version: pkg.version,
  journeys: interaction?.journeys || {},
  forbiddenSideEffects: interaction?.forbiddenSideEffects || {},
  missingJourneys,
  missingCommands: interaction?.missing || [],
  missingJobKinds: interaction?.missingJobKinds || [],
  commandCount: Array.isArray(interaction?.commands) ? interaction.commands.length : 0,
  generatedAt: new Date().toISOString()
};

if (ok) fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ...evidence, evidencePath }, null, 2));
process.exit(ok ? 0 : 2);
