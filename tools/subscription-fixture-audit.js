import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(root, 'src-tauri', 'fixtures', 'subscriptions');
const mainRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const required = ['clash-basic.yaml', 'mixed-uri.txt', 'unsupported-protocol.txt'];
const fail = [];
const pass = [];

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

const fixtureTexts = required.map((name) => {
  const file = path.join(fixtureDir, name);
  return {
    name,
    exists: fs.existsSync(file),
    text: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '',
  };
});

check(
  'sanitized subscription fixtures exist',
  fixtureTexts.every((item) => item.exists),
  required.join(', ')
);

const combined = fixtureTexts.map((item) => item.text).join('\n');
check(
  'fixtures are sanitized',
  combined.includes('example.com') &&
    combined.includes('00000000-0000-4000-8000-000000000000') &&
    !/token=|linkon|suuwu|api\/linkon|eyJhZGQi|[a-f0-9]{32,}/i.test(combined),
  'example domains and fixed fake ids only'
);

check(
  'fixtures cover Clash YAML, base64 URI, modern protocol families, and unsupported protocols',
  mainRs.includes('sanitized_subscription_fixtures_parse_without_real_tokens') &&
    mainRs.includes('sanitized_subscription_fixture_reports_unsupported_protocols') &&
    mainRs.includes('include_str!("../fixtures/subscriptions/clash-basic.yaml")') &&
    mainRs.includes('include_str!("../fixtures/subscriptions/mixed-uri.txt")') &&
    mainRs.includes('include_str!("../fixtures/subscriptions/unsupported-protocol.txt")') &&
    mainRs.includes('general_purpose::STANDARD.encode(mixed)') &&
    ['trojan://', 'vless://', 'hysteria2://', 'anytls://', 'tuic://'].every((scheme) => combined.includes(scheme)),
  'Rust regression tests use sanitized fixtures for Trojan/VLESS/Hysteria2/AnyTLS/TUIC'
);

check(
  'package exposes fixture audit',
  pkg.scripts?.['audit:subscription-fixtures'] === 'node tools/subscription-fixture-audit.js',
  'npm run audit:subscription-fixtures'
);

const result = { ok: fail.length === 0, failed: fail, passed: pass };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
