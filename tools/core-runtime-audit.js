import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = [];
const pass = [];

const expectedVersion = 'v1.19.28';
const expectedSha256 = 'c14bda8dc4cc8910ccd2110fe2be083c51a1b66da59141a0b87aff6fe6126517';
const coreRel = path.join('resources', 'core', 'mihomo.exe');
const corePath = path.join(root, coreRel);

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const packageJson = readJson('package.json');
const tauri = readJson('src-tauri/tauri.conf.json');
const mainRs = read('src-tauri/src/main.rs');
const coreRuntimeRs = read('src-tauri/src/core_runtime.rs');
const releaseAudit = read('tools/release-audit.js');
const activeConnectionCommandBody = mainRs.match(/fn active_connection_count\(state: State<AppState>\) -> Result<JsonValue, String> \{([\s\S]*?)\n\}/)?.[1] || '';

function hasControllerCall(method, timeout) {
  return new RegExp(`controller\\s*\\.\\s*${method}\\(\\s*${timeout}\\s*\\)`).test(mainRs);
}

function hasControllerCallWithArg(method, arg, timeout) {
  return new RegExp(`controller\\s*\\.\\s*${method}\\(\\s*${arg}\\s*,\\s*${timeout}\\s*\\)`).test(mainRs);
}

const exists = fs.existsSync(corePath);
const actualSha = exists ? sha256(corePath) : '';
let versionOutput = '';
if (exists) {
  try {
    versionOutput = execFileSync(corePath, ['-v'], { encoding: 'utf8', timeout: 2500 });
  } catch (err) {
    versionOutput = String(err?.message || err);
  }
}

check('core binary exists in resources/core', exists, coreRel);
check('core binary hash matches the approved managed asset', actualSha === expectedSha256, actualSha);
check('core binary reports the approved version', versionOutput.includes(`Mihomo Meta ${expectedVersion}`), versionOutput.trim());
check('core binary keeps gVisor tag', versionOutput.includes('with_gvisor'), versionOutput.trim());
check(
  'Tauri bundles only the managed mihomo dataplane resource',
  tauri.bundle?.resources?.['../resources/core/mihomo.exe'] === 'core/mihomo.exe' &&
    !tauri.bundle?.resources?.['../resources/core/archive'],
  JSON.stringify(tauri.bundle?.resources || {}),
);
check(
  'Aegos exposes core runtime identity through status and command',
  [
    'pub const ENGINE: &str = "mihomo"',
    'pub const ROLE: &str = "Aegos Network Engine dataplane"',
    `pub const EXPECTED_VERSION: &str = "${expectedVersion}"`,
    'pub const RESOURCE_SUBDIR: &str = "core"',
    'pub const BINARY_NAME: &str = "mihomo.exe"',
    'pub const MISSING_RESOURCE_HINT',
    expectedSha256,
    'pub struct CoreRuntimeContract',
    'pub fn identity_json',
    'pub fn runtime_status_json',
    'pub fn resolve_core_path',
    'runtime_core_resource_paths_are_owned_by_runtime_boundary',
    'fn core_runtime_info(&self) -> JsonValue',
    'CoreRuntimeContract::default()',
    'core_runtime::runtime_status_json',
    'core_runtime::resolve_core_path',
    'core_runtime::MISSING_RESOURCE_HINT',
    '#[tauri::command]\nfn core_runtime_info',
    'core_runtime_info,',
  ].every((token) => mainRs.includes(token) || coreRuntimeRs.includes(token)),
  'core runtime identity is not fully wired',
);
check(
  'Aegos routes controller access through the CoreController adapter',
  coreRuntimeRs.includes('pub struct CoreController') &&
    coreRuntimeRs.includes('pub fn controller_request') &&
    coreRuntimeRs.includes('pub fn traffic_snapshot(&self, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn connections_snapshot(&self, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn connections_snapshot_or_empty(&self, running: bool, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn active_connection_count(&self, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn active_connection_count_snapshot_or_idle(') &&
    coreRuntimeRs.includes('pub fn close_connection(&self, id: &str, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn close_connections(&self, timeout_ms: u64)') &&
    mainRs.includes('fn core_controller(&self) -> core_runtime::CoreController') &&
    mainRs.includes('self.core_controller()') &&
    !mainRs.includes('.request(method, endpoint, body, timeout_ms)') &&
    !mainRs.includes('fn controller(') &&
    !mainRs.includes('fn controller_request(') &&
    !mainRs.includes('self.controller(') &&
    mainRs.includes('self.core_controller().traffic_snapshot(timeout_ms)') &&
    mainRs.includes('controller.connections_snapshot_or_empty(running, 900)') &&
    mainRs.includes('controller.active_connection_count_snapshot_or_idle(running, 350)') &&
    !activeConnectionCommandBody.includes('now_secs') &&
    hasControllerCallWithArg('close_connection', '&id', 2000) &&
    hasControllerCall('close_connections', 3000) &&
    !mainRs.includes('Client::builder()\n        .no_proxy()\n        .timeout(Duration::from_millis(timeout_ms))\n        .build()'),
  'controller calls must go through core_runtime instead of rebuilding ad-hoc clients',
);
check(
  'Aegos routes proxy control APIs through typed CoreController methods',
  coreRuntimeRs.includes('pub fn proxies_snapshot(&self, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn proxy_groups_snapshot(') &&
    coreRuntimeRs.includes('fn normalize_proxy_item') &&
    coreRuntimeRs.includes('pub fn select_proxy(&self, group: &str, proxy: &str, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn proxy_delay_with_client(') &&
    coreRuntimeRs.includes('pub fn proxy_delay_result_with_client(') &&
    coreRuntimeRs.includes('pub fn classify_delay_http_failure(') &&
    mainRs.includes('.proxy_groups_snapshot(1200, &[AEGOS_OUTBOUND_IP_GROUP])') &&
    !mainRs.includes('.proxies_snapshot(1200)') &&
    !mainRs.includes('fn normalize_proxy_item') &&
    mainRs.includes('.proxy_delay_result_with_client(client, name, test_url, timeout_ms)') &&
    !mainRs.includes('fn classify_delay_http_failure') &&
    mainRs.includes('.select_proxy(AEGOS_OUTBOUND_IP_GROUP, &proxy, 1500)') &&
    mainRs.includes('.select_proxy(group, proxy, 5000)') &&
    !mainRs.includes('controller_request(controller_port, secret, "GET", "/proxies"') &&
    !mainRs.includes('http://127.0.0.1:{}/proxies/{}/delay') &&
    !/self\.controller\(\s*"PUT"\s*,\s*&format!\("\/proxies\//.test(mainRs),
  'proxy groups, delay probes, and explicit node selection must stay behind core_runtime typed APIs',
);
check(
  'Aegos routes readiness and mode control through typed CoreController methods',
  coreRuntimeRs.includes('pub fn version_probe(&self, timeout_ms: u64)') &&
    coreRuntimeRs.includes('pub fn set_mode(&self, mode: &str, timeout_ms: u64)') &&
    mainRs.includes('self.core_controller().version_probe(900)') &&
    mainRs.includes('self.core_controller().version_probe(300)') &&
    mainRs.includes('self.core_controller().set_mode(mode, 3000)') &&
    mainRs.includes('self.core_controller().close_connections(1500)') &&
    !mainRs.includes('fn controller(') &&
    !mainRs.includes('self.controller('),
  'main.rs must not keep a generic controller escape hatch for /version, /configs, or /connections',
);
check(
  'Aegos starts the dataplane through a CoreLaunchPlan',
  coreRuntimeRs.includes('pub struct CoreLaunchPlan') &&
    coreRuntimeRs.includes('pub fn launch_command') &&
    coreRuntimeRs.includes('.stdin(Stdio::null())') &&
    coreRuntimeRs.includes('.stdout(Stdio::piped())') &&
    coreRuntimeRs.includes('.stderr(Stdio::piped())') &&
    mainRs.includes('CoreLaunchPlan::new') &&
    mainRs.includes('.display_label()') &&
    mainRs.includes('.command()') &&
    !mainRs.includes('Command::new(&self.core_path)'),
  'dataplane process launch must be planned by core_runtime',
);
check(
  'Aegos normalizes runtime profile YAML through the core runtime boundary',
  coreRuntimeRs.includes('pub struct CoreRuntimeProfile') &&
    coreRuntimeRs.includes('pub fn render_runtime_profile_yaml') &&
    coreRuntimeRs.includes('fn apply_interface_binding') &&
    coreRuntimeRs.includes('fn sha256_text') &&
    mainRs.includes('core_runtime::render_runtime_profile_yaml') &&
    !mainRs.includes('fn apply_runtime_interface_binding_name') &&
    !mainRs.includes('serde_yaml::from_str(&rendered.yaml)'),
  'runtime YAML normalization, interface binding, and runtime digest must stay inside core_runtime',
);
check(
  'Aegos writes runtime profile files through the core runtime boundary',
  coreRuntimeRs.includes('pub struct CoreRuntimeProfileWrite') &&
    coreRuntimeRs.includes('pub fn write_runtime_profile') &&
    coreRuntimeRs.includes('fn atomic_write_text_confined') &&
    coreRuntimeRs.includes('fn ensure_path_within') &&
    coreRuntimeRs.includes('refusing to write runtime profile outside core home') &&
    mainRs.includes('core_runtime::write_runtime_profile') &&
    !mainRs.includes('atomic_write_text_confined(&runtime_path, &self.home_dir'),
  'runtime profile writes must be path-confined and owned by core_runtime',
);
check(
  'Aegos applies runtime profiles through an audited core runtime transaction',
  coreRuntimeRs.includes('pub struct CoreRuntimeApplyTransaction') &&
    coreRuntimeRs.includes('pub struct CoreRuntimeApplyResult') &&
    coreRuntimeRs.includes('pub fn apply(&self, controller: &CoreController)') &&
    coreRuntimeRs.includes('"/configs?force=true"') &&
    coreRuntimeRs.includes('controller.request("GET", "/version", None, 900)') &&
    mainRs.includes('CoreRuntimeApplyTransaction::new') &&
    mainRs.includes('apply_transaction.apply(&self.core_controller())') &&
    !mainRs.includes('"/configs?force=true"'),
  'runtime config apply must be owned by core_runtime instead of ad-hoc controller calls in main.rs',
);
check(
  'release gate requires core runtime audit',
  packageJson.scripts?.['audit:core-runtime'] === 'node tools/core-runtime-audit.js' &&
    releaseAudit.includes('core runtime audit script exists'),
  'package.json/tools/release-audit.js',
);

const result = {
  ok: fail.length === 0,
  expectedVersion,
  expectedSha256,
  actualSha,
  versionOutput: versionOutput.trim(),
  failed: fail,
  passed: pass,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
