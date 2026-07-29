import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const noticePath = path.join(root, 'THIRD_PARTY_NOTICES.md');
const aggregatePath = path.join(root, 'third_party', 'rust', 'THIRD_PARTY_LICENSES.txt');

function normalize(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\s+$/u, '') + '\n';
}

export function repositoryTextSha256(value) {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  const canonical = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function runCargoTree() {
  const result = spawnSync('cargo', [
    'tree',
    '--manifest-path', 'src-tauri/Cargo.toml',
    '--target', 'x86_64-pc-windows-msvc',
    '--edges', 'normal,build',
    '--prefix', 'none',
    '--format', '{p}',
    '--locked'
  ], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`cargo tree failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function registrySourceRoots() {
  const cargoHome = process.env.CARGO_HOME || path.join(os.homedir(), '.cargo');
  const registrySrc = path.join(cargoHome, 'registry', 'src');
  if (!fs.existsSync(registrySrc)) throw new Error(`Cargo registry source cache is missing: ${registrySrc}`);
  return fs.readdirSync(registrySrc, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(registrySrc, entry.name))
    .sort();
}

function parsePackageField(toml, field) {
  const packageStart = toml.match(/^\[package\]\s*$/m);
  if (!packageStart) return '';
  const tail = toml.slice(packageStart.index + packageStart[0].length);
  const nextSection = tail.search(/^\[/m);
  const section = nextSection >= 0 ? tail.slice(0, nextSection) : tail;
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return section.match(new RegExp(`^${escaped}\\s*=\\s*"([^"]*)"`, 'm'))?.[1] || '';
}

function findCrateDirectory(sourceRoots, name, version) {
  const expected = `${name}-${version}`;
  for (const sourceRoot of sourceRoots) {
    const candidate = path.join(sourceRoot, expected);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
  }
  throw new Error(`Cargo registry source is missing for ${name} ${version}`);
}

function collectLicenseFiles(crateDir, explicitLicenseFile) {
  const candidates = new Set();
  for (const entry of fs.readdirSync(crateDir, { withFileTypes: true })) {
    if (entry.isFile() && /^(LICENSE|LICENCE|COPYING|NOTICE|COPYRIGHT|UNLICENSE)([._-].*)?$/i.test(entry.name)) {
      candidates.add(entry.name);
    }
  }
  if (explicitLicenseFile) candidates.add(explicitLicenseFile.replaceAll('/', path.sep));
  const files = [...candidates].sort((left, right) => left.localeCompare(right, 'en'));
  for (const file of files) {
    const full = path.resolve(crateDir, file);
    const rel = path.relative(crateDir, full);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      throw new Error(`Declared license material is missing or unsafe: ${path.basename(crateDir)}/${file}`);
    }
  }
  return files;
}

function pinnedMaterial(fullPath, label, expectedSha256) {
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    throw new Error(`Pinned fallback license material is missing: ${label}`);
  }
  const actual = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
  if (actual !== expectedSha256) {
    throw new Error(`Pinned fallback license material drifted: ${label} (${actual})`);
  }
  return { fullPath, label };
}

function pinnedRepositoryTextMaterial(fullPath, label, expectedSha256) {
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    throw new Error(`Pinned fallback license material is missing: ${label}`);
  }
  const actual = repositoryTextSha256(fs.readFileSync(fullPath));
  if (actual !== expectedSha256) {
    throw new Error(`Pinned fallback license material drifted: ${label} (${actual})`);
  }
  return { fullPath, label };
}

function fallbackMaterials(sourceRoots, key) {
  const registryMaterial = (name, version, file, expectedSha256) => pinnedMaterial(
    path.join(findCrateDirectory(sourceRoots, name, version), file),
    `${name} ${version}/${file}`,
    expectedSha256
  );
  const repositoryMaterial = (file, expectedSha256) => pinnedRepositoryTextMaterial(
    path.join(root, 'third_party', 'rust', 'upstream', file),
    `third_party/rust/upstream/${file}`,
    expectedSha256
  );
  if (key === 'alloc-stdlib@0.2.4') {
    return [registryMaterial('alloc-no-stdlib', '2.0.4', 'LICENSE', 'c0c56f26d9c051cac4d200c34c84e7ae9aaa853e01a982a1df08b09931e518ae')];
  }
  if (key === 'selectors@0.36.1') {
    return [registryMaterial('cssparser', '0.36.0', 'LICENSE', 'fab3dd6bdab226f1c08630b1dd917e11fcb4ec5e1e020e2c16f83a0a13863e85')];
  }
  const unicKeys = new Set([
    'unic-char-property@0.9.0',
    'unic-char-range@0.9.0',
    'unic-common@0.9.0',
    'unic-ucd-ident@0.9.0',
    'unic-ucd-version@0.9.0'
  ]);
  if (unicKeys.has(key)) {
    return [
      repositoryMaterial('rust-unic-COPYRIGHT.md', 'f5c342c49f3ac804f3e8e7bb62a8040a44c50d47bb36902b1abd13f66a1adf8b'),
      registryMaterial('anyhow', '1.0.103', 'LICENSE-APACHE', '62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a'),
      registryMaterial('anyhow', '1.0.103', 'LICENSE-MIT', '23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3')
    ];
  }
  const webviewKeys = new Set([
    'webview2-com@0.38.2',
    'webview2-com-macros@0.8.1',
    'webview2-com-sys@0.38.2'
  ]);
  if (webviewKeys.has(key)) {
    return [repositoryMaterial('webview2-rs-LICENSE', '0dcf41516e608bbcb6cdc5229feb7b86fe4a643b85e7df251133c93408fdac73')];
  }
  return [];
}

function rustPackages() {
  const packages = new Map();
  for (const rawLine of runCargoTree().split(/\r?\n/)) {
    const line = rawLine.trim().replace(/ \(\*\)$/u, '');
    const match = line.match(/^([A-Za-z0-9_.-]+) v([^\s]+)(?:\s|$)/u);
    if (!match || match[1] === 'aegos') continue;
    packages.set(`${match[1]}@${match[2]}`, { name: match[1], version: match[2] });
  }
  const sourceRoots = registrySourceRoots();
  const missing = [];
  const resolved = [...packages.values()]
    .sort((left, right) => left.name.localeCompare(right.name, 'en') || left.version.localeCompare(right.version, 'en'))
    .map((pkg) => {
      const crateDir = findCrateDirectory(sourceRoots, pkg.name, pkg.version);
      const manifestPath = path.join(crateDir, 'Cargo.toml');
      if (!fs.existsSync(manifestPath)) throw new Error(`Normalized Cargo.toml is missing for ${pkg.name} ${pkg.version}`);
      const manifest = fs.readFileSync(manifestPath, 'utf8');
      const license = parsePackageField(manifest, 'license');
      const licenseFile = parsePackageField(manifest, 'license-file');
      const repository = parsePackageField(manifest, 'repository');
      const files = collectLicenseFiles(crateDir, licenseFile);
      const materials = files.length
        ? files.map((file) => ({ fullPath: path.join(crateDir, file), label: file.replaceAll('\\', '/') }))
        : fallbackMaterials(sourceRoots, `${pkg.name}@${pkg.version}`);
      if (!license && !licenseFile) missing.push(`${pkg.name} ${pkg.version}: no Cargo license metadata`);
      if (materials.length === 0) missing.push(`${pkg.name} ${pkg.version}: no cached or pinned fallback license text (${license || licenseFile || 'unknown license'})`);
      return { ...pkg, license: license || `license-file: ${licenseFile}`, repository, materials };
    });
  if (missing.length) throw new Error(`Incomplete Cargo license material:\n- ${missing.join('\n- ')}`);
  return resolved;
}

function renderNotice(packages) {
  const rows = packages.map((pkg) => {
    const upstream = pkg.repository ? `[upstream](${pkg.repository})` : 'repository not declared';
    return `| \`${pkg.name}\` | \`${pkg.version}\` | \`${pkg.license}\` | ${upstream} | ${pkg.materials.map((material) => `\`${material.label}\``).join(', ')} |`;
  }).join('\n');
  return normalize(`# Aegos third-party notices

This file is generated deterministically by \`tools/generate-third-party-notices.js\`.
Run \`npm run generate:licenses\` after a locked dependency change and
\`npm run audit:licenses\` before packaging. Do not edit generated sections by hand.

## Aegos

Aegos is licensed under \`GPL-3.0-only\`. The complete license text is in the
repository root \`LICENSE\` and is included in the installer as
\`licenses/AEGOS-GPL-3.0.txt\`.

## Mihomo managed data plane

Aegos packages the unmodified official Mihomo \`v1.19.28\` Windows amd64 v1
binary under \`GPL-3.0-only\`. Exact release, commit, archive, executable, hash,
license, and corresponding-source links are recorded in
\`third_party/mihomo/provenance.json\` and \`third_party/mihomo/SOURCE.md\`.
The complete upstream GPLv3 text is in \`third_party/mihomo/LICENSE\`.

## Microsoft Fluent UI System Icons

The locally archived icon subset is from \`microsoft/fluentui-system-icons\`
commit \`9a1129bb2432b163b48044341664c68a3c100908\` under the MIT License. The
complete upstream license is in \`third_party/fluent-ui-system-icons/LICENSE\`
and is included in the installer.

## Rust normal and build dependency inventory

The following ${packages.length} packages are the unique non-Aegos packages in the locked
Windows x64 MSVC normal/build graph. Complete cached license and notice texts are
aggregated in \`third_party/rust/THIRD_PARTY_LICENSES.txt\`.

| Package | Version | Cargo license metadata | Upstream | Included cached material |
| --- | --- | --- | --- | --- |
${rows}

## Build-only JavaScript tooling

\`@tauri-apps/cli\` is used to build Aegos and is not distributed as a runtime
file in the NSIS payload. Its package metadata declares \`Apache-2.0 OR MIT\`.
No npm runtime dependency is packaged by Aegos.
`);
}

function renderAggregate(packages) {
  const sections = packages.map((pkg) => {
    const files = pkg.materials.map((material) => {
      const text = normalize(fs.readFileSync(material.fullPath, 'utf8'));
      return `----- BEGIN ${material.label} -----\n${text}----- END ${material.label} -----`;
    }).join('\n\n');
    return `================================================================================\n${pkg.name} ${pkg.version}\nCargo license metadata: ${pkg.license}\nRepository: ${pkg.repository || 'not declared'}\n================================================================================\n${files}`;
  });
  return normalize(`Aegos Rust third-party license texts\nGenerated deterministically from the locked Windows x64 MSVC normal/build graph.\nPackage count: ${packages.length}\n\n${sections.join('\n\n')}`);
}

function checkOrWrite(target, expected) {
  if (checkOnly) {
    if (!fs.existsSync(target)) throw new Error(`Generated license material is missing: ${path.relative(root, target)}`);
    const actual = normalize(fs.readFileSync(target, 'utf8'));
    if (actual !== expected) throw new Error(`Generated license material is stale: ${path.relative(root, target)}`);
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, expected, 'utf8');
}

export function buildLicenseOutputs() {
  const packages = rustPackages();
  return {
    packages,
    notice: renderNotice(packages),
    aggregate: renderAggregate(packages)
  };
}

function main() {
  try {
    const { packages, notice, aggregate } = buildLicenseOutputs();
    checkOrWrite(noticePath, notice);
    checkOrWrite(aggregatePath, aggregate);
    console.log(JSON.stringify({
      ok: true,
      mode: checkOnly ? 'check' : 'write',
      rustPackages: packages.length,
      outputs: [path.relative(root, noticePath), path.relative(root, aggregatePath)]
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
