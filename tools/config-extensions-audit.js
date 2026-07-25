import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const passed = [];
const failed = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function check(name, ok, detail = '') {
  (ok ? passed : failed).push({ name, ok: Boolean(ok), detail });
}

const pkg = JSON.parse(read('package.json'));
const appConfig = read('src-tauri/src/app_config.rs');
const extensions = read('src-tauri/src/config_extensions.rs');
const pipeline = read('src-tauri/src/config_pipeline.rs');
const main = read('src-tauri/src/main.rs');
const coreRuntime = read('src-tauri/src/core_runtime.rs');
const app = read('src/app.js');
const styles = read('src/styles.css');
const interaction = read('tools/interaction-smoke.js');
const releaseAudit = read('tools/release-audit.js');

check(
  'configuration extensions audit is exposed',
  pkg.scripts?.['audit:config-extensions'] === 'node tools/config-extensions-audit.js',
  'npm run audit:config-extensions'
);

check(
  'extension intent is persisted as Aegos settings with migration defaults',
  ['additional_rules_enabled', 'additional_rules', 'override_script_enabled', 'override_script']
    .every((field) => appConfig.includes(`pub(crate) ${field}`)) &&
    (appConfig.match(/#\[serde\(default\)\]/g) || []).length >= 8 &&
    appConfig.includes('additional_rules_enabled: false') &&
    appConfig.includes('override_script: String::new()') &&
    main.includes('Settings::product_default('),
  'Settings remains the persisted product boundary'
);

check(
  'runtime compiler owns extension application without modifying subscription source',
  main.includes('mod config_extensions;') &&
    pipeline.includes('config_extensions::apply_to_runtime(&mut config, settings)?;') &&
    extensions.includes('pub(crate) fn apply_to_runtime') &&
    !extensions.includes('fs::') &&
    !extensions.includes('Command::') &&
    !extensions.includes('reqwest'),
  'runtime-only deterministic config extension'
);

check(
  'additional rules are bounded, deduplicated, and inserted before fallback',
  extensions.includes('MAX_ADDITIONAL_RULES') &&
    extensions.includes('MAX_RULE_LENGTH') &&
    extensions.includes('"MATCH" | "FINAL"') &&
    extensions.includes('let insert_at = rules') &&
    extensions.includes('existing.insert(rule.clone())') &&
    extensions.includes('additional_rules_are_deduplicated_and_inserted_before_fallback'),
  'bounded additional rule overlay'
);

check(
  'override YAML is bounded and protects Aegos-owned runtime fields',
  extensions.includes('MAX_OVERRIDE_BYTES') &&
    extensions.includes('MAX_OVERRIDE_DEPTH') &&
    extensions.includes('MAX_OVERRIDE_NODES') &&
    extensions.includes('PROTECTED_ROOT_KEYS') &&
    extensions.includes('"external-controller"') &&
    extensions.includes('"secret"') &&
    extensions.includes('"tun"') &&
    extensions.includes('"dns"') &&
    extensions.includes('"rules"') &&
    extensions.includes('Override YAML tags are not supported') &&
    extensions.includes('protected_runtime_ownership_and_terminal_rules_are_rejected'),
  'safe YAML merge contract'
);

check(
  'settings transaction validates, applies, restarts, and can roll back extensions',
  main.includes('config_extensions::apply_candidate_value(&mut candidate, key, value)?;') &&
    extensions.includes('validate_settings(settings)') &&
    extensions.includes('"additionalRulesEnabled"') &&
    extensions.includes('"overrideScript"') &&
    main.includes('fn rollback_settings_after_failure') &&
    coreRuntime.includes('"configExtensions": config_extensions'),
  'existing updateSettings transaction'
);

check(
  'settings UI exposes one configuration extensions workspace',
    app.includes("['extensions', '\\u914d\\u7f6e\\u6269\\u5c55'") &&
    app.includes("panel('extensions', '\\u914d\\u7f6e\\u6269\\u5c55'") &&
    app.includes("'additionalRulesInput',") &&
    app.includes("'overrideScriptInput',") &&
    app.includes("id: 'saveConfigExtensionsBtn'") &&
    app.includes('function saveConfigExtensions') &&
    styles.includes('.config-extensions-content') &&
    styles.includes('.config-extension-editor textarea'),
  'configuration extensions settings category'
);

check(
  'configuration extension save is covered as a background user journey',
  interaction.includes('[data-settings-category="extensions"]') &&
    interaction.includes('DOMAIN-SUFFIX,example.com,Proxies') &&
    interaction.includes("document.querySelector('#overrideScriptInput').value = 'sniffer:") &&
    interaction.includes("item.args.kind === 'updateSettings'") &&
    interaction.includes('configuration extensions did not save through the settings background job'),
  'interaction smoke extension save'
);

check(
  'release gate includes the configuration extension contract',
  releaseAudit.includes('configuration extensions audit script exists') &&
    releaseAudit.includes('audit:config-extensions'),
  'tools/release-audit.js'
);

const result = {
  ok: failed.length === 0,
  failed,
  passed,
  generatedAt: new Date().toISOString()
};
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
