import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
const subscriptionRuntimeRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'subscription_runtime.rs'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const fail = [];
const pass = [];

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

check(
  'subscription diagnostics helper exists',
  subscriptionRuntimeRs.includes('pub(crate) fn diagnostic(') &&
    subscriptionRuntimeRs.includes('Open Logs or Diagnostics for details') &&
    subscriptionRuntimeRs.includes('Subscription diagnostics [{stage}]') &&
    !mainRs.includes('fn subscription_diagnostic('),
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
  ].every((stage) =>
    (stage === 'runtime-preflight' ? mainRs : subscriptionRuntimeRs).includes(`"${stage}"`)
  ),
  'download, parse, protocol, and runtime-preflight stages'
);

check(
  'diagnostic download path is used by import and update',
  (mainRs.match(/subscription_runtime::download_source_url/g) || []).length === 3 &&
    mainRs.includes('add_profile_url_detached') &&
    mainRs.includes('update_profile_detached') &&
    subscriptionRuntimeRs.includes('pub(crate) fn download_source_url(') &&
    subscriptionRuntimeRs.includes('parse_source_text(&text)') &&
    !mainRs.includes('fn download_profile_source_url_diagnostic'),
  'detached subscription paths call the domain-owned diagnostic downloader directly'
);

check(
  'subscription text normalization is shared and testable',
  subscriptionRuntimeRs.includes('pub(crate) fn decoded_body') &&
    subscriptionRuntimeRs.includes("trim_start_matches('\\u{feff}')") &&
    subscriptionRuntimeRs.includes('decode_base64_text(raw).unwrap_or_else') &&
    subscriptionRuntimeRs.includes('pub(crate) fn parse_source_text(') &&
    subscriptionRuntimeRs.includes('parse_source_text(&text)') &&
    !mainRs.includes('fn decoded_subscription_body') &&
    !mainRs.includes('fn parse_profile_source_text_diagnostic'),
  'downloaded text is normalized before YAML/URI parsing'
);

check(
  'airport metadata and comments are ignored in URI subscriptions',
  subscriptionRuntimeRs.includes('pub(crate) fn is_ignorable_line(') &&
    subscriptionRuntimeRs.includes('subscription-userinfo:') &&
    subscriptionRuntimeRs.includes('profile-title:') &&
    subscriptionRuntimeRs.includes('profile-update-interval:') &&
    mainRs.includes('subscription_parser_ignores_metadata_comments_and_blank_lines') &&
    !mainRs.includes('fn is_ignorable_subscription_line'),
  'comments/airport info lines do not count as unsupported proxy lines'
);

check(
  'unsupported URI protocols are detected before generic format failure',
  subscriptionRuntimeRs.includes('pub(crate) const AEGOS_URI_PROTOCOLS') &&
    subscriptionRuntimeRs.includes('pub(crate) fn unsupported_uri_schemes') &&
    subscriptionRuntimeRs.includes('unsupported URI protocol(s)') &&
    subscriptionRuntimeRs.includes('pub(crate) fn parse_uri_source(') &&
    mainRs.includes('ssr://example-one') &&
    mainRs.includes('wireguard://example-two') &&
    !mainRs.includes('fn unsupported_uri_schemes'),
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
    subscriptionRuntimeRs.includes("trim_start_matches('\\u{feff}')") &&
    subscriptionRuntimeRs.includes('decode_base64_text(raw).unwrap_or_else'),
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
