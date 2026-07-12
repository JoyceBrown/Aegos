import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const speedAudit = fs.readFileSync(path.join(root, 'tools', 'speed-closure-audit.js'), 'utf8');
const contractPath = 'provider-healthcheck-contract.md';
const contract = fs.existsSync(path.join(root, contractPath)) ? fs.readFileSync(path.join(root, contractPath), 'utf8') : '';
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const pass = [];
const fail = [];

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

check('provider healthcheck contract exists', Boolean(contract), contractPath);
check(
  'contract separates provider health from node switching',
  ['subscription/provider health', 'must not imply', 'The current connected node changed', 'Aegos selected the best node'].every((text) => contract.includes(text)),
  'product boundary'
);
check(
  'contract defines planned mihomo API boundary',
  ['GET /providers/proxies', 'GET /providers/proxies/{provider}/healthcheck', 'Not exposed in UI', 'Not called by Aegos runtime'].every((text) => contract.includes(text)),
  'API boundary'
);
check(
  'contract keeps provider cache separate from speed and selected state',
  ['selected_proxy_map', 'speed.delays', 'providerHealth', 'must stay separate'].every((text) => contract.includes(text)),
  'state separation'
);
check(
  'contract requires safety proof before implementation',
  ['Record `selected_proxy_map`', 'Run provider healthcheck', 'Assert selected node and selected map did not change', 'Assert no `change_proxy` path ran'].every((text) => contract.includes(text)),
  'safety proof'
);
check(
  'runtime does not expose provider healthcheck yet',
  !mainRs.includes('/providers/proxies/{provider}/healthcheck') &&
    !mainRs.includes('provider_healthcheck') &&
    !appJs.includes('provider_healthcheck') &&
    !appJs.includes('providerHealthcheck'),
  'no runtime/UI entry point'
);
check(
  'ordinary speed audit remains the speed-test authority',
  speedAudit.includes('batch speed-test backend does not switch proxies') &&
    speedAudit.includes('speed-test targets exclude proxy-group references') &&
    speedAudit.includes('batch speed probes align with FlClash delay-test defaults'),
  'speed audit separation'
);
check('package version is 2.9.56 for this checkpoint', pkg.version === '2.9.56', pkg.version);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
