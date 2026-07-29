import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const validationRoot = path.join(root, '.validation', 'lic01');

function argument(name, fallback = '') {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeRelative(candidate) {
  const absolute = path.resolve(root, candidate);
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Path must stay inside the repository: ${candidate}`);
  return { absolute, relative: relative.replaceAll('\\', '/') };
}

const expected = {
  'core/mihomo.exe': 'resources/core/mihomo.exe',
  'licenses/AEGOS-GPL-3.0.txt': 'LICENSE',
  'licenses/THIRD_PARTY_NOTICES.md': 'THIRD_PARTY_NOTICES.md',
  'licenses/MIHOMO-GPL-3.0.txt': 'third_party/mihomo/LICENSE',
  'licenses/MIHOMO-SOURCE.md': 'third_party/mihomo/SOURCE.md',
  'licenses/MIHOMO-PROVENANCE.json': 'third_party/mihomo/provenance.json',
  'licenses/FLUENT-UI-SYSTEM-ICONS-MIT.txt': 'third_party/fluent-ui-system-icons/LICENSE',
  'licenses/RUST-THIRD-PARTY-LICENSES.txt': 'third_party/rust/THIRD_PARTY_LICENSES.txt',
  'licenses/RUST-LICENSE-EXCEPTIONS.md': 'third_party/rust/LICENSE_EXCEPTIONS.md'
};

function main() {
  const installerArg = argument('installer', `src-tauri/target/release/bundle/nsis/Aegos_${pkg.version}_x64-setup.exe`);
  const extractorArg = argument('extractor', process.env.AEGOS_7Z_EXE || '');
  const reportArg = argument('write-report', '');
  if (!extractorArg) throw new Error('Missing --extractor=<absolute 7z.exe path> or AEGOS_7Z_EXE');
  const installer = safeRelative(installerArg);
  const extractor = path.resolve(extractorArg);
  if (!fs.existsSync(installer.absolute) || !fs.statSync(installer.absolute).isFile()) throw new Error(`Installer is missing: ${installer.relative}`);
  if (!fs.existsSync(extractor) || !fs.statSync(extractor).isFile()) throw new Error(`Extractor is missing: ${extractor}`);

  fs.mkdirSync(validationRoot, { recursive: true });
  const extractionRoot = fs.mkdtempSync(path.join(validationRoot, 'payload-audit-'));
  const resolvedValidationRoot = path.resolve(validationRoot) + path.sep;
  if (!path.resolve(extractionRoot).startsWith(resolvedValidationRoot) || !path.basename(extractionRoot).startsWith('payload-audit-')) {
    throw new Error(`Unsafe extraction root: ${extractionRoot}`);
  }

  let result;
  try {
    const extract = spawnSync(extractor, ['x', '-y', `-o${extractionRoot}`, installer.absolute], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    });
    if (extract.status !== 0) throw new Error(`7-Zip NSIS extraction failed (${extract.status}): ${extract.stderr || extract.stdout}`);
    const matches = Object.entries(expected).map(([payloadPath, sourcePath]) => {
      const payload = path.join(extractionRoot, ...payloadPath.split('/'));
      const source = path.join(root, sourcePath);
      const payloadExists = fs.existsSync(payload) && fs.statSync(payload).isFile();
      const sourceExists = fs.existsSync(source) && fs.statSync(source).isFile();
      const payloadBytes = payloadExists ? fs.statSync(payload).size : null;
      const sourceBytes = sourceExists ? fs.statSync(source).size : null;
      const payloadSha256 = payloadExists ? sha256(payload) : null;
      const sourceSha256 = sourceExists ? sha256(source) : null;
      return {
        payloadPath,
        sourcePath,
        ok: payloadExists && sourceExists && payloadBytes === sourceBytes && payloadSha256 === sourceSha256,
        payloadBytes,
        sourceBytes,
        payloadSha256,
        sourceSha256
      };
    });
    const extractorVersion = spawnSync(extractor, ['i'], { cwd: root, encoding: 'utf8', windowsHide: true }).stdout
      .split(/\r?\n/).find((line) => line.startsWith('7-Zip '))?.trim() || path.basename(extractor);
    result = {
      ok: matches.every((item) => item.ok),
      schema: 'aegos.installer-payload-audit/v1',
      productVersion: pkg.version,
      installer: {
        path: installer.relative,
        bytes: fs.statSync(installer.absolute).size,
        sha256: sha256(installer.absolute)
      },
      extractor: {
        name: extractorVersion,
        platform: `${os.platform()}-${os.arch()}`,
        bytes: fs.statSync(extractor).size,
        sha256: sha256(extractor)
      },
      format: 'NSIS-3 Unicode (7-Zip direct extraction)',
      matches,
      extractionCleaned: true,
      generatedAt: new Date().toISOString()
    };
  } finally {
    fs.rmSync(extractionRoot, { recursive: true, force: false });
  }

  if (reportArg) {
    const report = safeRelative(reportArg);
    fs.mkdirSync(path.dirname(report.absolute), { recursive: true });
    fs.writeFileSync(report.absolute, JSON.stringify(result, null, 2) + '\n');
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
}
