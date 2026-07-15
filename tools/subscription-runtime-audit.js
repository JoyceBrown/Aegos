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
    mainRs.includes('use subscription_runtime::{ProfileSource, ProfileSourceSummary};'),
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
    mainRs.includes('fn subscription_diagnostic') &&
    mainRs.includes('subscription_runtime::diagnostic(stage, reason, suggestion)'),
  'diagnostic copy boundary',
);

check(
  'subscription source summary is owned by subscription_runtime',
  subscriptionRuntimeRs.includes('pub(crate) fn summarize_source(') &&
    subscriptionRuntimeRs.includes('"subscription contains no usable proxies"') &&
    mainRs.includes('fn summarize_profile_source(') &&
    mainRs.includes('subscription_runtime::summarize_source(config, format, unsupported_lines)'),
  'summary/counting boundary',
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
