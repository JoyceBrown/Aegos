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
const fluentAssetDir = 'third_party/fluent-ui-system-icons';
const fluentLicense = read(`${fluentAssetDir}/LICENSE`);
const licenseAudit = read('docs/ui/LICENSE_AUDIT.md');
const brandSvg = read('src/assets/brand/aegos-mark.svg');
const brandRaster = fs.readFileSync(path.join(root, 'src/assets/brand/aegos-mark-64.png'));
const brandSource = read(`${fluentAssetDir}/brand-source/ic_fluent_shield_48_filled.svg`);
const tauriConfig = JSON.parse(read('src-tauri/tauri.conf.json'));
const windowsIcon = fs.readFileSync(path.join(root, 'src-tauri/icons/icon.ico'));
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
const fluentSvgFiles = fs.readdirSync(path.join(root, fluentAssetDir)).filter((file) => file.endsWith('.svg'));
const missingEmbeddedFluentIcons = fluentSvgFiles.filter((file) => {
  const encoded = fs.readFileSync(path.join(root, fluentAssetDir, file)).toString('base64');
  return !css.includes(`data:image/svg+xml;base64,${encoded}`);
});

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
check('Fluent icon subset is local, embedded, complete, and runtime-free', fluentSvgFiles.length === 38 && missingEmbeddedFluentIcons.length === 0 && !html.includes('fluentui-system-icons') && !app.includes('fluentui-system-icons'), `${fluentSvgFiles.length} assets / missing embedded data: ${missingEmbeddedFluentIcons.join(', ')}`);
check('Fluent navigation variants include regular and filled states', ['home', 'branch_fork', 'plug_connected', 'arrow_routing', 'document_arrow_down', 'pulse', 'settings'].every((name) => fluentSvgFiles.includes(`ic_fluent_${name}_20_regular.svg`) && fluentSvgFiles.includes(`ic_fluent_${name}_20_filled.svg`)));
check('third-party icon license and pinned source are preserved', fluentLicense.includes('MIT License') && licenseAudit.includes('9a1129bb2432b163b48044341664c68a3c100908') && licenseAudit.includes('Microsoft Fluent UI System Icons') && brandSource.includes('M24.8646 4.34751'));
check('legacy hand-drawn UI icons are removed', (css.match(/data:image\/svg\+xml;base64/g) || []).length === 38 && (css.match(/data:image\/svg\+xml,%3Csvg/g) || []).length === 0 && !css.includes('.icon-brand'), `${(css.match(/data:image\/svg\+xml;base64/g) || []).length} Fluent UI icons`);
check('brand source, sidebar mark, and Windows icon share one master', brandSvg.includes('data-fluent-source="Shield 48 Filled"') && brandSvg.includes('aegosRoute') && brandRaster.subarray(1, 4).toString('ascii') === 'PNG' && html.includes('class="brand-logo" src="assets/brand/aegos-mark-64.png"') && tauriConfig.bundle?.icon?.includes('icons/icon.ico') && windowsIcon.readUInt16LE(4) >= 6, `${windowsIcon.readUInt16LE(4)} Windows icon sizes`);
check('typography uses deterministic Windows system stacks', ['--font-ui:', '--font-display:', '--font-mono:', 'Segoe UI Variable Text', 'Segoe UI Variable Display', 'Microsoft YaHei UI', 'font-variant-numeric: tabular-nums'].every((token) => css.includes(token)) && !css.includes('"Inter"'));
check('DPI smoke covers 100 through 200 percent', [1, 1.25, 1.5, 1.75, 2].every((scale) => uiSmoke.includes(`, ${scale})`)));
check('UI smoke records effective device scale', uiSmoke.includes('deviceScaleFactor: window.devicePixelRatio'));
check('stage 7 audit is exposed by package', packageJson.scripts?.['audit:stage7-visual'] === 'node tools/stage7-visual-audit.js');
check('stage 7 did not add important patches', (css.match(/!important/g) || []).length <= 12, `${(css.match(/!important/g) || []).length} !important declarations`);

const result = { ok: failures.length === 0, failed: failures, passed, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
