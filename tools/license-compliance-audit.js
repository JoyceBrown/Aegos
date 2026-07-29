import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLicenseOutputs } from './generate-third-party-notices.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedVersion = '3.6.71';
const gplSha256 = '3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986';
const coreSha256 = 'c14bda8dc4cc8910ccd2110fe2be083c51a1b66da59141a0b87aff6fe6126517';

function normalize(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\s+$/u, '') + '\n';
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function reader(overrides = new Map()) {
  const key = (rel) => rel.replaceAll('\\', '/');
  const get = (rel) => {
    const normalized = key(rel);
    if (overrides.has(normalized)) {
      const value = overrides.get(normalized);
      if (value === null) throw new Error(`missing fixture path: ${normalized}`);
      return Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
    }
    return fs.readFileSync(path.join(root, normalized));
  };
  return {
    exists(rel) {
      const normalized = key(rel);
      return overrides.has(normalized) ? overrides.get(normalized) !== null : fs.existsSync(path.join(root, normalized));
    },
    buffer: get,
    text(rel) { return get(rel).toString('utf8'); },
    json(rel) { return JSON.parse(get(rel).toString('utf8')); },
    hash(rel) { return sha256(get(rel)); },
    size(rel) { return get(rel).length; }
  };
}

function packageField(toml, field) {
  const packageStart = toml.match(/^\[package\]\s*$/m);
  if (!packageStart) return '';
  const tail = toml.slice(packageStart.index + packageStart[0].length);
  const nextSection = tail.search(/^\[/m);
  const section = nextSection >= 0 ? tail.slice(0, nextSection) : tail;
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return section.match(new RegExp(`^${escaped}\\s*=\\s*"([^"]*)"`, 'm'))?.[1] || '';
}

function audit(overrides = new Map(), generated = null) {
  const io = reader(overrides);
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });
  const safeJson = (rel) => {
    try { return io.json(rel); } catch { return {}; }
  };
  const safeText = (rel) => {
    try { return io.text(rel); } catch { return ''; }
  };

  const pkg = safeJson('package.json');
  const packageLock = safeJson('package-lock.json');
  const cargoToml = safeText('src-tauri/Cargo.toml');
  const tauri = safeJson('src-tauri/tauri.conf.json');
  const provenance = safeJson('third_party/mihomo/provenance.json');
  const releaseDoc = `RELEASE_${expectedVersion}.md`;
  const expectedOutputs = generated || buildLicenseOutputs();

  check('root GPL-3.0 text exists and is exact', io.exists('LICENSE') && io.hash('LICENSE') === gplSha256, io.exists('LICENSE') ? io.hash('LICENSE') : 'missing');
  check('npm package declares GPL-3.0-only and 3.6.71', pkg.license === 'GPL-3.0-only' && pkg.version === expectedVersion, `${pkg.license || 'missing'}/${pkg.version || 'missing'}`);
  check('npm lock root records license and 3.6.71', packageLock.version === expectedVersion && packageLock.packages?.['']?.version === expectedVersion && packageLock.packages?.['']?.license === 'GPL-3.0-only', `${packageLock.version || 'missing'}/${packageLock.packages?.['']?.version || 'missing'}/${packageLock.packages?.['']?.license || 'missing'}`);
  check('Cargo package declares GPL-3.0-only and 3.6.71', packageField(cargoToml, 'license') === 'GPL-3.0-only' && packageField(cargoToml, 'version') === expectedVersion, `${packageField(cargoToml, 'license') || 'missing'}/${packageField(cargoToml, 'version') || 'missing'}`);
  check('Tauri package version is 3.6.71', tauri.version === expectedVersion, tauri.version || 'missing');

  check('Mihomo provenance schema and identity are fixed', provenance.schema === 'aegos.third-party-provenance/v1' && provenance.component === 'mihomo' && provenance.version === 'v1.19.28' && provenance.tagCommit === 'cbd11db1e13a75d8e680e0fe7742c95be4cba2be', `${provenance.version || 'missing'}/${provenance.tagCommit || 'missing'}`);
  check('Mihomo official archive is fixed', provenance.asset?.name === 'mihomo-windows-amd64-v1-v1.19.28.zip' && provenance.asset?.url === 'https://github.com/MetaCubeX/mihomo/releases/download/v1.19.28/mihomo-windows-amd64-v1-v1.19.28.zip' && provenance.asset?.bytes === 17730829 && provenance.asset?.sha256 === 'e1a47d4eb9b864e242e92ef4d501b052241c7e4eb5a592f2b124959e8efb2312', `${provenance.asset?.bytes || 'missing'}/${provenance.asset?.sha256 || 'missing'}`);
  check('Mihomo executable provenance is fixed and unmodified', provenance.extracted?.repoPath === 'resources/core/mihomo.exe' && provenance.extracted?.bytes === 47942656 && provenance.extracted?.sha256 === coreSha256 && provenance.extracted?.modified === false, `${provenance.extracted?.bytes || 'missing'}/${provenance.extracted?.sha256 || 'missing'}/${provenance.extracted?.modified}`);
  check('managed Mihomo executable matches provenance', io.exists('resources/core/mihomo.exe') && io.size('resources/core/mihomo.exe') === 47942656 && io.hash('resources/core/mihomo.exe') === coreSha256, io.exists('resources/core/mihomo.exe') ? `${io.size('resources/core/mihomo.exe')}/${io.hash('resources/core/mihomo.exe')}` : 'missing');
  check('Mihomo GPL text matches provenance', provenance.license?.spdx === 'GPL-3.0-only' && provenance.license?.path === 'third_party/mihomo/LICENSE' && provenance.license?.bytes === 35149 && provenance.license?.sha256 === gplSha256 && io.exists('third_party/mihomo/LICENSE') && io.size('third_party/mihomo/LICENSE') === 35149 && io.hash('third_party/mihomo/LICENSE') === gplSha256, `${provenance.license?.spdx || 'missing'}/${provenance.license?.sha256 || 'missing'}`);

  check('third-party notice is generated and current', io.exists('THIRD_PARTY_NOTICES.md') && normalize(io.text('THIRD_PARTY_NOTICES.md')) === expectedOutputs.notice, io.exists('THIRD_PARTY_NOTICES.md') ? io.hash('THIRD_PARTY_NOTICES.md') : 'missing');
  check('Rust license aggregate is generated and current', io.exists('third_party/rust/THIRD_PARTY_LICENSES.txt') && normalize(io.text('third_party/rust/THIRD_PARTY_LICENSES.txt')) === expectedOutputs.aggregate, io.exists('third_party/rust/THIRD_PARTY_LICENSES.txt') ? io.hash('third_party/rust/THIRD_PARTY_LICENSES.txt') : 'missing');
  check('Rust missing-text exceptions are documented', io.exists('third_party/rust/LICENSE_EXCEPTIONS.md') && safeText('third_party/rust/LICENSE_EXCEPTIONS.md').includes('Ten') && safeText('third_party/rust/LICENSE_EXCEPTIONS.md').includes('fails closed'), 'third_party/rust/LICENSE_EXCEPTIONS.md');

  const requiredResources = {
    '../resources/core/mihomo.exe': 'core/mihomo.exe',
    '../LICENSE': 'licenses/AEGOS-GPL-3.0.txt',
    '../THIRD_PARTY_NOTICES.md': 'licenses/THIRD_PARTY_NOTICES.md',
    '../third_party/mihomo/LICENSE': 'licenses/MIHOMO-GPL-3.0.txt',
    '../third_party/mihomo/SOURCE.md': 'licenses/MIHOMO-SOURCE.md',
    '../third_party/mihomo/provenance.json': 'licenses/MIHOMO-PROVENANCE.json',
    '../third_party/fluent-ui-system-icons/LICENSE': 'licenses/FLUENT-UI-SYSTEM-ICONS-MIT.txt',
    '../third_party/rust/THIRD_PARTY_LICENSES.txt': 'licenses/RUST-THIRD-PARTY-LICENSES.txt',
    '../third_party/rust/LICENSE_EXCEPTIONS.md': 'licenses/RUST-LICENSE-EXCEPTIONS.md'
  };
  check('Tauri bundle license metadata is GPL-3.0-only', tauri.bundle?.license === 'GPL-3.0-only' && tauri.bundle?.licenseFile === '../LICENSE', `${tauri.bundle?.license || 'missing'}/${tauri.bundle?.licenseFile || 'missing'}`);
  const resources = tauri.bundle?.resources || {};
  const missingResources = Object.entries(requiredResources).filter(([source, target]) => resources[source] !== target);
  check('Tauri bundle maps every required license and provenance resource', missingResources.length === 0, missingResources.map(([source]) => source).join(', ') || `${Object.keys(requiredResources).length} resources`);

  const readme = safeText('README.md');
  check('README discloses Aegos license and packaged materials', readme.includes('GPL-3.0-only') && readme.includes('THIRD_PARTY_NOTICES.md') && readme.includes('licenses/'), 'README.md');
  const release = safeText(releaseDoc);
  check('3.6.71 release record discloses license payload', io.exists(releaseDoc) && release.includes('GPL-3.0-only') && release.includes('THIRD_PARTY_NOTICES.md') && release.includes('Mihomo') && release.includes('licenses/'), releaseDoc);

  check('license generator and audits are package commands', pkg.scripts?.['generate:licenses'] === 'node tools/generate-third-party-notices.js' && pkg.scripts?.['audit:licenses'] === 'node tools/license-compliance-audit.js' && pkg.scripts?.['audit:licenses-fixtures'] === 'node tools/license-compliance-audit.js --self-test' && pkg.scripts?.['audit:installer-payload'] === 'node tools/installer-payload-audit.js', 'package.json scripts');
  const wrAcceptance = safeText('tools/wr01-acceptance.js');
  check('host-safe acceptance runs real and fixture license gates', wrAcceptance.includes('audit:licenses') && wrAcceptance.includes('audit:licenses-fixtures'), 'tools/wr01-acceptance.js');
  const candidateProvenance = safeText('tools/candidate-provenance-audit.js');
  check('candidate provenance binds license gates and materials', candidateProvenance.includes('audit:licenses') && candidateProvenance.includes('audit:licenses-fixtures') && candidateProvenance.includes('THIRD_PARTY_NOTICES.md') && candidateProvenance.includes('third_party/mihomo/provenance.json'), 'tools/candidate-provenance-audit.js');
  check('release audit requires license audit', safeText('tools/release-audit.js').includes('audit:licenses'), 'tools/release-audit.js');
  check('installer candidate audit requires license and actual payload audits', safeText('tools/installer-candidate-audit.js').includes('audit:licenses') && safeText('tools/installer-candidate-audit.js').includes('payload-audit.json') && io.exists('tools/installer-payload-audit.js'), 'tools/installer-candidate-audit.js');
  check('installer regression audit requires license audit', safeText('tools/installer-regression-audit.js').includes('audit:licenses'), 'tools/installer-regression-audit.js');
  const planningAudit = safeText('tools/planning-context-audit.js');
  check('planning audit knows LIC-01 evidence owner', planningAudit.includes('LIC-01') && planningAudit.includes('docs/work/license-packaging-lic01.md'), 'tools/planning-context-audit.js');

  const failed = results.filter((item) => !item.ok);
  return { ok: failed.length === 0, failed, passed: results.filter((item) => item.ok) };
}

function runSelfTest() {
  const generated = buildLicenseOutputs();
  const baseline = audit(new Map(), generated);
  if (!baseline.ok) {
    return { ok: false, baselineFailed: baseline.failed, fixtures: [] };
  }
  const jsonOverride = (rel, mutate) => {
    const value = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
    mutate(value);
    return JSON.stringify(value, null, 2) + '\n';
  };
  const textOverride = (rel, mutate) => mutate(fs.readFileSync(path.join(root, rel), 'utf8'));
  const fixtures = [
    { name: 'tampered-root-license', overrides: new Map([['LICENSE', Buffer.from('tampered GPL text\n')]]), expected: 'root GPL-3.0 text exists and is exact' },
    { name: 'cargo-spdx-mismatch', overrides: new Map([['src-tauri/Cargo.toml', textOverride('src-tauri/Cargo.toml', (text) => text.replace('license = "GPL-3.0-only"', 'license = "MIT"'))]]), expected: 'Cargo package declares GPL-3.0-only and 3.6.71' },
    { name: 'mutated-mihomo-origin', overrides: new Map([['third_party/mihomo/provenance.json', jsonOverride('third_party/mihomo/provenance.json', (value) => { value.tagCommit = 'bad'; value.asset.sha256 = 'bad'; value.asset.bytes += 1; })]]), expected: 'Mihomo provenance schema and identity are fixed' },
    { name: 'mutated-managed-core', overrides: new Map([['resources/core/mihomo.exe', Buffer.from('not the managed core')]]), expected: 'managed Mihomo executable matches provenance' },
    { name: 'missing-tauri-license-resource', overrides: new Map([['src-tauri/tauri.conf.json', jsonOverride('src-tauri/tauri.conf.json', (value) => { delete value.bundle.resources['../third_party/mihomo/LICENSE']; })]]), expected: 'Tauri bundle maps every required license and provenance resource' },
    { name: 'stale-third-party-notice', overrides: new Map([['THIRD_PARTY_NOTICES.md', textOverride('THIRD_PARTY_NOTICES.md', (text) => `${text}\nstale\n`)]]), expected: 'third-party notice is generated and current' },
    { name: 'missing-rust-license-aggregate', overrides: new Map([['third_party/rust/THIRD_PARTY_LICENSES.txt', null]]), expected: 'Rust license aggregate is generated and current' },
    { name: 'mutated-mihomo-license', overrides: new Map([['third_party/mihomo/LICENSE', Buffer.from('wrong license\n')]]), expected: 'Mihomo GPL text matches provenance' }
  ].map((fixture) => {
    const result = audit(fixture.overrides, generated);
    const rejected = !result.ok && result.failed.some((item) => item.name === fixture.expected);
    return { name: fixture.name, rejected, expectedFailure: fixture.expected, observedFailures: result.failed.map((item) => item.name) };
  });
  return { ok: fixtures.every((fixture) => fixture.rejected), baselineFailed: [], fixtures };
}

try {
  const result = process.argv.includes('--self-test') ? runSelfTest() : audit();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
}
