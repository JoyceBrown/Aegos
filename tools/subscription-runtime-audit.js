import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = [];
const pass = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

const pkg = readJson('package.json');
const mainRs = read('src-tauri/src/main.rs');
const subscriptionRuntimeRs = read('src-tauri/src/subscription_runtime.rs');
const releaseAudit = read('tools/release-audit.js');

check(
  'subscription runtime module is wired',
  mainRs.includes('mod subscription_runtime;') &&
    mainRs.includes('use subscription_runtime::ProfileSourceSummary;') &&
    mainRs.includes('subscription_runtime::download_source_url(') &&
    mainRs.includes('subscription_runtime::parse_source_text('),
  'main.rs imports subscription runtime boundary',
);

check(
  'subscription source data model is owned by subscription_runtime',
  subscriptionRuntimeRs.includes('pub(crate) struct ProfileSourceSummary') &&
    subscriptionRuntimeRs.includes('pub(crate) struct ProfileSource') &&
    subscriptionRuntimeRs.includes('pub(crate) config: YamlValue') &&
    subscriptionRuntimeRs.includes('pub(crate) summary: ProfileSourceSummary') &&
    !mainRs.includes('struct ProfileSourceSummary') &&
    !mainRs.includes('struct ProfileSource {'),
  'ProfileSource/ProfileSourceSummary must not live in main.rs',
);

check(
  'subscription diagnostics text is owned by subscription_runtime',
  subscriptionRuntimeRs.includes('pub(crate) fn diagnostic(') &&
    subscriptionRuntimeRs.includes('Subscription diagnostics [{stage}]') &&
    subscriptionRuntimeRs.includes('Open Logs or Diagnostics for details') &&
    mainRs.includes('subscription_runtime::diagnostic(') &&
    !mainRs.includes('fn subscription_diagnostic('),
  'diagnostic copy boundary',
);

check(
  'subscription source summary is owned by subscription_runtime',
  subscriptionRuntimeRs.includes('pub(crate) fn summarize_source(') &&
    subscriptionRuntimeRs.includes('"subscription contains no usable proxies"') &&
    mainRs.includes('subscription_runtime::summarize_source(&config, "profile-file", 0)') &&
    !mainRs.includes('fn summarize_profile_source('),
  'summary/counting boundary',
);

check(
  'subscription text normalization is owned by subscription_runtime',
  subscriptionRuntimeRs.includes('pub(crate) fn is_ignorable_line(') &&
    subscriptionRuntimeRs.includes('pub(crate) fn decoded_body(') &&
    subscriptionRuntimeRs.includes('pub(crate) fn unsupported_uri_schemes(') &&
    subscriptionRuntimeRs.includes('pub(crate) fn looks_like_clash_yaml(') &&
    subscriptionRuntimeRs.includes('fn decode_base64_text(') &&
    subscriptionRuntimeRs.includes('pub(crate) fn parse_uri_subscription(') &&
    subscriptionRuntimeRs.includes('pub(crate) fn parse_uri_source(') &&
    subscriptionRuntimeRs.includes('pub(crate) fn parse_source_text(') &&
    subscriptionRuntimeRs.includes('pub(crate) fn download_source_url(') &&
    subscriptionRuntimeRs.includes('pub(crate) const AEGOS_URI_PROTOCOLS') &&
    mainRs.includes('subscription_runtime::AEGOS_URI_PROTOCOLS') &&
    !mainRs.includes('fn is_ignorable_subscription_line') &&
    !mainRs.includes('fn decoded_subscription_body') &&
    !mainRs.includes('fn parse_uri_subscription(') &&
    !mainRs.includes('fn download_profile_source_url_diagnostic'),
  'BOM/base64/metadata/protocol filtering boundary',
);

check(
  'subscription runtime audit is wired into package and release gate',
  pkg.scripts?.['audit:subscription-runtime'] === 'node tools/subscription-runtime-audit.js' &&
    releaseAudit.includes('subscription runtime audit script exists'),
  'package.json/tools/release-audit.js',
);

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
