import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
const exists = (...parts) => fs.existsSync(path.join(root, ...parts));
const main = read('src-tauri', 'src', 'main.rs');
const commands = read('src-tauri', 'src', 'runtime_command.rs');
const takeover = read('src-tauri', 'src', 'system_takeover.rs');
const routing = read('src-tauri', 'src', 'routing_domain.rs');
const runtime = read('src-tauri', 'src', 'core_runtime.rs');
const app = read('src', 'app.js');
const pkg = JSON.parse(read('package.json'));

const passed = [];
const failed = [];
const check = (name, ok, detail) => (ok ? passed : failed).push({ name, ok, detail });

check(
  'runtime mutations use a product command coordinator with a visible snapshot',
  main.includes('mod runtime_command;') &&
    main.includes('RuntimeOperationCoordinator') &&
    main.includes('"runtimeOperation"') &&
    commands.includes('pub enum RuntimeCommand') &&
    commands.includes('pub fn from_operation_label') &&
    commands.includes('pub struct RuntimeOperationSnapshot') &&
    commands.includes('coordinator_publishes_and_clears_the_active_mutation'),
  'typed command vocabulary, exclusive lease, and app-status observation'
);

check(
  'system takeover recovery reports corrupt journals and uses durable Windows replacement',
  takeover.includes('pub struct TakeoverRecoveryScan') &&
    takeover.includes('pub fn recovery_scan') &&
    takeover.includes('unreadable_journals') &&
    takeover.includes('MoveFileExW') &&
    takeover.includes('corrupt_journal_is_reported_instead_of_being_silently_ignored') &&
    takeover.includes('active_takeover_state_is_durable_and_removed_after_full_recovery') &&
    main.includes('System takeover recovery journal is unreadable'),
  'corruption is an incident, not an ignored recovery record'
);

check(
  'rules and strategy groups compile from Aegos semantics rather than raw engine strings',
  routing.includes('pub(crate) enum RoutingConditionKind') &&
    routing.includes('pub(crate) enum RoutingTarget') &&
    routing.includes('pub(crate) struct RoutingIntent') &&
    routing.includes('pub(crate) enum StrategyPolicy') &&
    routing.includes('semantic_intent_compiles_reserved_actions_deterministically') &&
    routing.includes('fn engine_kind') &&
    routing.includes('fn engine_group_type'),
  'semantic intent and policy compile through one Mihomo-specific boundary'
);

check(
  'engine upgrades require approved identity and capabilities',
  runtime.includes('pub struct EngineCapabilityManifest') &&
    runtime.includes('pub struct EngineUpgradeAssessment') &&
    runtime.includes('pub fn assess_engine_candidate') &&
    runtime.includes('engine_upgrade_requires_exact_identity_and_control_plane_capabilities') &&
    runtime.includes('"upgradeAssessment"'),
  'version, digest, and capability set are jointly evaluated'
);

check(
  'runtime operation state is rendered in the product status center',
  app.includes('function runtimeOperationLabel') &&
    app.includes('runtimeOperationState') &&
    app.includes('runtimeOperation: status.runtimeOperation'),
  'frontend receives the backend snapshot without a second command model'
);

check(
  'control-plane acceptance, baseline, and integration-governance records exist',
  exists('CONTROL_PLANE_ACCEPTANCE.md') &&
    exists('CONTROL_PLANE_BASELINE.md') &&
    exists('MIHOMO_INTEGRATION_GOVERNANCE.md') &&
    pkg.scripts?.['audit:control-plane'] === 'node tools/control-plane-audit.js',
  'release evidence and future upstream boundary are documented'
);

const result = { ok: failed.length === 0, failed, passed, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
