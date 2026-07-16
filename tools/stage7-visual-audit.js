import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const css = read('src/styles.css');
const html = read('src/index.html');
const app = read('src/app.js');
const uiSmoke = read('tools/ui-smoke.js');
const packageJson = JSON.parse(read('package.json'));
const baseline = JSON.parse(read('STAGE7_BEHAVIOR_BASELINE.json'));
const failures = [];
const passed = [];

function check(name, condition, detail = '') {
  (condition ? passed : failures).push({ name, detail });
}

function literalInvokeCounts(source) {
  const counts = {};
  for (const match of source.matchAll(/invoke\(\s*['"]([^'"]+)['"]/g)) {
    counts[match[1]] = (counts[match[1]] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

const requiredTokens = [
  '--surface-canvas', '--surface-panel', '--surface-panel-strong', '--surface-control',
  '--text-primary', '--text-secondary', '--text-tertiary', '--border-subtle', '--border-active',
  '--status-success', '--status-warning', '--status-danger', '--status-info', '--focus-ring',
  '--motion-fast', '--motion-normal', '--motion-slow', '--ease-standard',
  '--app-shell-padding', '--app-sidebar-width', '--home-hero-row', '--home-quick-row'
];

check('stage 7 visual contract exists', exists('STAGE7_VISUAL_SYSTEM.md'));
check('3.6.24 behavior snapshot exists', baseline.version === '3.6.24');
check('literal Tauri command surface is frozen', JSON.stringify(literalInvokeCounts(app)) === JSON.stringify(baseline.literalInvokeCounts));
check('semantic visual tokens are complete', requiredTokens.every((token) => css.includes(`${token}:`)), requiredTokens.filter((token) => !css.includes(`${token}:`)).join(', '));
check('root ownership is consolidated', (css.match(/^:root\s*\{/gm) || []).length <= 2, `${(css.match(/^:root\s*\{/gm) || []).length} root blocks`);
check('historical visual ownership comments removed', !/2\.7\.(0|1|5|7|8|14).*visual|2\.7\.(0|1|5|7|8|14).*layout|2\.7\.14 icon/.test(css));
check('global keyboard focus is visible', css.includes(':where(button, input, select, textarea, summary, [role="button"], [role="tab"]):focus-visible') && css.includes('outline: 2px solid var(--focus-ring)'));
check('reduced motion is supported', css.includes('@media (prefers-reduced-motion: reduce)') && css.includes('animation-duration: .01ms'));
check('forced colors remain usable', css.includes('@media (forced-colors: active)'));
check('button motion never scales', !/button[^\{]*\{[^\}]*transform:\s*scale/gs.test(css));
check('hover translation is limited to one pixel', css.includes('transform: translateY(-1px)') && !/translateY\(-([2-9]|\d{2,})px\)/.test(css));
check('window controls use mask icons', ['icon-minimize', 'icon-maximize', 'icon-close'].every((name) => css.includes(`.${name}`)) && !html.includes('>−</button>') && !html.includes('>□</button>') && !html.includes('>×</button>'));
check('window controls have Chinese names and tooltips', ['最小化', '最大化', '关闭'].every((label) => html.includes(`aria-label="${label}" title="${label}"`)));
check('dynamic dialog close uses icon and tooltip', app.includes("title: '关闭'") && app.includes("[icon('icon-close')]") && !app.includes("[text('')])"));
check('node icon actions have Chinese accessible names', ['测试节点延迟', '编辑节点', '为网站使用此节点', '收藏节点'].every((label) => app.includes(label)) && !app.includes("ariaLabel: 'test delay'") && !app.includes('ariaLabel: `select ${name}`'));
check('home favorites use the centralized icon registry', app.includes("icon(`star ${favorite ? 'icon-star-filled' : 'icon-star'}`)"));
check('DPI smoke covers 100 through 200 percent', [1, 1.25, 1.5, 1.75, 2].every((scale) => uiSmoke.includes(`, ${scale})`)));
check('UI smoke records effective device scale', uiSmoke.includes('deviceScaleFactor: window.devicePixelRatio'));
check('stage 7 audit is exposed by package', packageJson.scripts?.['audit:stage7-visual'] === 'node tools/stage7-visual-audit.js');
check('stage 7 did not add important patches', (css.match(/!important/g) || []).length <= 12, `${(css.match(/!important/g) || []).length} !important declarations`);

const result = { ok: failures.length === 0, failed: failures, passed, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
