import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const pkg = JSON.parse(read('package.json'));
const html = read('src/index.html');
const app = read('src/app.js');
const css = read('src/styles.css');
const licenseAudit = read('docs/ui/LICENSE_AUDIT.md');
const failures = [];
const passed = [];

function check(name, condition, detail = '') {
  (condition ? passed : failures).push({ name, detail });
}

const requiredDocs = [
  'AGENTS.md',
  'docs/ui/DEPLOYMENT_EVALUATION.md',
  'docs/ui/TECH_STACK_AUDIT.md',
  'docs/ui/AEGOS_UI_SPEC.md',
  'docs/ui/DESIGN_TOKENS.md',
  'docs/ui/INTERACTION_STATES.md',
  'docs/ui/UI_RUNTIME_FLOW.md',
  'docs/ui/UI_DUPLICATION_AUDIT.md',
  'docs/ui/LICENSE_AUDIT.md'
];
const dependencyNames = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
const forbiddenFrameworks = dependencyNames.filter((name) => /react|@mui|shadcn|tailwind/i.test(name));
const sidebarStart = html.indexOf('<aside class="sidebar">');
const sidebarEnd = html.indexOf('</aside>', sidebarStart);
const sidebarHtml = html.slice(sidebarStart, sidebarEnd);
const productionJs = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

check('UI architecture documents exist', requiredDocs.every(exists), requiredDocs.filter((file) => !exists(file)).join(', '));
check('native frontend remains single-stack', forbiddenFrameworks.length === 0, forbiddenFrameworks.join(', '));
check('production rendering avoids dangerous HTML sinks', !/\.innerHTML\s*=|insertAdjacentHTML\s*\(/.test(productionJs));
check('page code does not fetch the controller directly', !/\bfetch\s*\(/.test(productionJs) && !/127\.0\.0\.1:19091/.test(app));
check('page code does not parse or write runtime YAML', !/js-?yaml|yaml\.parse|yaml\.stringify|parseDocument/i.test(app));
check('Stage 7 semantic token contract remains', ['--surface-canvas', '--text-primary', '--status-success', '--focus-ring', '--motion-fast', '--home-quick-row'].every((token) => css.includes(`${token}:`)));
check('detailed runtime state moved out of sidebar', sidebarHtml.includes('sidebar-runtime-summary') && !sidebarHtml.includes('id="softwareState"') && !sidebarHtml.includes('id="jobRows"'));
check('status center preserves runtime truth fields', ['softwareState', 'networkAvailabilityState', 'protectMode', 'dnsState', 'tunState', 'killState', 'proxyState', 'lanIpState', 'protocolState', 'proxyPortState', 'outboundIpState', 'jobRows'].every((id) => html.includes(`id="${id}"`)));
check('status center is keyboard and focus managed', app.includes('function openStatusCenter') && app.includes('function closeStatusCenter') && app.includes("event.key === 'Escape' && statusCenterOpen") && app.includes("event.key === 'Tab' && statusCenterOpen"));
check('status center is frontend-only', !/function openStatusCenter[\s\S]{0,1200}invoke\(/.test(app));
check('GPL sources remain reference-only', /GPL/i.test(licenseAudit) && /reference-only|reference only|不复制|不直接复制/i.test(licenseAudit));
check('architecture audit is exposed by package', pkg.scripts?.['audit:ui-architecture'] === 'node tools/ui-architecture-audit.js');

const result = { ok: failures.length === 0, failed: failures, passed, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
