import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const installer = `src-tauri/target/release/bundle/nsis/Aegos_${pkg.version}_x64-setup.exe`;
const verifier = 'tools/verify-authenticode.ps1';
const requireSigned = process.argv.includes('--require-signed');
const checks = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

check('release trust audit is exposed as a package script', pkg.scripts?.['audit:release-trust'] === 'node tools/release-trust-audit.js');
check('release verification runs the signed-candidate gate', read('tools/release-verify.js').includes("['npm', ['run', 'audit:release-trust', '--', '--require-signed']]"));
check('Authenticode verifier exists', exists(verifier), verifier);

if (exists(verifier)) {
  const verifierSource = read(verifier);
  check('verifier has separate preflight and verify modes', verifierSource.includes("ValidateSet('preflight', 'verify')"));
  check('preflight requires certificate reference, subject, HTTPS timestamp, and SignTool', verifierSource.includes('AEGOS_SIGNING_CERTIFICATE_PATH') && verifierSource.includes('AEGOS_SIGNING_EXPECTED_SUBJECT') && verifierSource.includes('AEGOS_SIGNING_TIMESTAMP_URL') && verifierSource.includes("Get-Command 'signtool.exe'") && verifierSource.includes("$timestampUri.Scheme -eq 'https'"));
  check('verification requires valid Authenticode status, exact signer subject, and timestamp', verifierSource.includes('Get-AuthenticodeSignature') && verifierSource.includes('SignatureStatus]::Valid') && verifierSource.includes('$actualSubject -eq $subject') && verifierSource.includes('TimeStamperCertificate'));
  check('verifier does not sign or read signing passwords', !verifierSource.includes('signtool sign') && !verifierSource.includes('AEGOS_SIGNING_CERTIFICATE_PASSWORD'));
}

if (requireSigned) {
  const command = process.platform === 'win32' ? 'powershell.exe' : 'powershell';
  const result = spawnSync(command, [
    '-NoProfile', '-NonInteractive', '-File', verifier,
    '-Mode', 'verify', '-InstallerPath', installer
  ], { cwd: root, encoding: 'utf8', shell: false });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  let verification = null;
  try { verification = JSON.parse(output); } catch { verification = null; }
  const verificationDetail = verification?.ok === true
    ? 'Authenticode policy satisfied'
    : verification?.checks?.filter((item) => !item.ok).map((item) => item.name).join('; ') || 'verifier did not return a valid result';
  check('signed installer verification passes', result.status === 0 && verification?.ok === true, verificationDetail);
}

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, requireSigned, installer, failed, passed: checks.filter((item) => item.ok) }, null, 2));
process.exit(failed.length ? 2 : 0);
