import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const fail = [];
const pass = [];

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

check(
  'subscription diagnostics helper exists',
  mainRs.includes('fn subscription_diagnostic') &&
    mainRs.includes('Open Logs or Diagnostics for details') &&
    mainRs.includes('Subscription diagnostics [{stage}]'),
  'stable user-facing diagnostic format'
);

check(
  'subscription failure stages are classified',
  [
    'invalid-url',
    'download-client',
    'download-failed',
    'http-status',
    'read-failed',
    'empty-content',
    'yaml-parse',
    'unsupported-format',
    'unsupported-protocol',
    'runtime-preflight',
  ].every((stage) => mainRs.includes(`"${stage}"`)),
  'download, parse, protocol, and runtime-preflight stages'
);

check(
  'diagnostic download path is used by import and update',
  (mainRs.match(/download_profile_source_url_diagnostic/g) || []).length >= 3 &&
    mainRs.includes('add_profile_url_detached') &&
    mainRs.includes('update_profile_detached') &&
    !/fn add_profile_url_detached[\s\S]*download_profile_source_url\(url\)\?/.test(mainRs) &&
    !/fn update_profile_detached[\s\S]*download_profile_source_url\(&url\)\?/.test(mainRs),
  'detached subscription paths use diagnostic downloader'
);

check(
  'subscription text normalization is shared and testable',
  mainRs.includes('fn decoded_subscription_body') &&
    mainRs.includes('fn parse_profile_source_text_diagnostic') &&
    mainRs.includes('download_profile_source_url_diagnostic') &&
    mainRs.includes('parse_profile_source_text_diagnostic(&text)'),
  'downloaded text is normalized before YAML/URI parsing'
);

check(
  'airport metadata and comments are ignored in URI subscriptions',
  mainRs.includes('fn is_ignorable_subscription_line') &&
    mainRs.includes('subscription-userinfo:') &&
    mainRs.includes('profile-title:') &&
    mainRs.includes('profile-update-interval:') &&
    mainRs.includes('subscription_parser_ignores_metadata_comments_and_blank_lines'),
  'comments/airport info lines do not count as unsupported proxy lines'
);

check(
  'unsupported URI protocols are detected before generic format failure',
  mainRs.includes('fn unsupported_uri_schemes') &&
    mainRs.includes('fn is_supported_uri_scheme') &&
    mainRs.includes('unsupported URI protocol(s)') &&
    mainRs.includes('ssr://example-one') &&
    mainRs.includes('wireguard://example-two'),
  'protocol-specific error path'
);

check(
  'diagnostic tests cover key failures',
  [
    'subscription_diagnostics_classify_unsupported_protocols',
    'subscription_diagnostics_classify_unsupported_format',
    'subscription_diagnostics_classify_invalid_url_scheme',
  ].every((name) => mainRs.includes(name)),
  'Rust unit tests'
);

check(
  'mixed base64 URI and BOM Clash YAML variants are covered',
  mainRs.includes('subscription_parser_accepts_base64_mixed_uri_sources') &&
    mainRs.includes('subscription_parser_accepts_bom_prefixed_clash_yaml') &&
    mainRs.includes("trim_start_matches('\\u{feff}')") &&
    mainRs.includes('b64_decode_text(raw).unwrap_or_else'),
  'common airport response wrappers'
);

check(
  'package exposes subscription audit',
  pkg.scripts?.['audit:subscription'] === 'node tools/subscription-diagnostics-audit.js',
  'npm run audit:subscription'
);

const result = { ok: fail.length === 0, failed: fail, passed: pass };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
