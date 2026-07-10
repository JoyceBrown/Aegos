import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = [];
const pass = [];

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

function sha256(rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
}

function readText(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const pkg = readJson('package.json');
const tauri = readJson('src-tauri/tauri.conf.json');
const cargoToml = readText('src-tauri/Cargo.toml');
const cargoVersion = cargoToml.match(/^version = "([^"]+)"/m)?.[1] || '';
const installer = `src-tauri/target/release/bundle/nsis/Aegos_${pkg.version}_x64-setup.exe`;
const installerSha = exists(installer) ? sha256(installer) : '';
const releaseDoc = `RELEASE_${pkg.version}.md`;
const releaseNotes = exists(releaseDoc) ? readText(releaseDoc) : '';
const sourceOnlyRelease = releaseNotes.includes('Source-only');

check('package name is aegos', pkg.name === 'aegos', pkg.name);
check('package/Tauri/Cargo versions match', pkg.version === tauri.version && pkg.version === cargoVersion, `${pkg.version}/${tauri.version}/${cargoVersion}`);
check('product name is Aegos', tauri.productName === 'Aegos', tauri.productName);
check('identifier does not collide with Aegis', tauri.identifier === 'com.codex.aegos', tauri.identifier);
check('Tauri shell configured', Boolean(pkg.devDependencies?.['@tauri-apps/cli']), '@tauri-apps/cli');
check('transparent window disabled for performance', tauri.app?.windows?.[0]?.transparent === false, `transparent=${tauri.app?.windows?.[0]?.transparent}`);
check('WebView2 online bootstrapper is skipped', tauri.bundle?.windows?.webviewInstallMode?.type === 'skip', JSON.stringify(tauri.bundle?.windows?.webviewInstallMode));
check('mihomo bundled as only core resource', exists('resources/core/mihomo.exe') && !exists('resources/core/sing-box.exe'), 'resources/core');
check('Aegos installer exists or release is source-only', exists(installer) || sourceOnlyRelease, installer);
check('Aegis installer name is not reused', !exists(`src-tauri/target/release/bundle/nsis/Aegis-Setup-${pkg.version}.exe`), 'no Aegis installer artifact');
check('UI smoke script exists', exists('tools/ui-smoke.js'), 'tools/ui-smoke.js');
check('performance smoke script exists', exists('tools/perf-smoke.js') && pkg.scripts?.['smoke:perf'] === 'node tools/perf-smoke.js', 'tools/perf-smoke.js');
check('backend audit script exists', exists('tools/backend-audit.js') && pkg.scripts?.['audit:backend'] === 'node tools/backend-audit.js', 'tools/backend-audit.js');

const mainRs = readText('src-tauri/src/main.rs');
const powershellCalls = (mainRs.match(/Command::new\("powershell\.exe"\)/g) || []).length;
check('PowerShell commands are hidden on Windows', powershellCalls === 1 && /fn run_powershell[\s\S]*creation_flags\(CREATE_NO_WINDOW\)/.test(mainRs), `${powershellCalls} powershell launcher(s)`);

const indexHtml = readText('src/index.html');
const appJs = readText('src/app.js');
const stylesCss = readText('src/styles.css');
const capabilitiesJson = readText('src-tauri/capabilities/default.json');
const interactionSmoke = readText('tools/interaction-smoke.js');
const perfSmoke = readText('tools/perf-smoke.js');
const uiText = `${indexHtml}\n${appJs}`;
const pageStyleBlock = stylesCss.match(/\.page\s*\{([\s\S]*?)\n\}/)?.[1] || '';
const statusBody = mainRs.match(/fn status\(&mut self\) -> JsonValue \{([\s\S]*?)\n    \}/)?.[1] || '';
const testNodesBody = appJs.match(/async function testNodes\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
check('UI text has no mojibake fragments', !/(�|鈫|鈱|鈼|鈻|鉁|鈬|脳|鏈|鍗|棣欐腐|绛夊緟)/.test(uiText), 'index/app text encoding');
check('sidebar version label matches package version', indexHtml.includes(`id="appVersionLabel" class="brand-version">v${pkg.version}</span>`), `v${pkg.version}`);
check('frontend fallback does not hardcode release version', appJs.includes('defaultAppVersion') && !appJs.includes(`appVersion: '${pkg.version}'`), 'defaultAppVersion');
check('Aegos defaults avoid FlClash/Codex port 7890', mainRs.includes('AEGOS_DEFAULT_MIXED_PORT: u16 = 7891') && appJs.includes('const defaultMixedPort = 7891') && !appJs.includes('127.0.0.1:7890'), 'mixed port 7891');
check('settings save rejects proxy port conflicts', mainRs.includes('fn validate_port_settings_snapshot') && mainRs.includes('RESERVED_MIXED_PORTS.contains(&settings.mixed_port)') && mainRs.includes('settings.mixed_port == settings.controller_port') && mainRs.includes('fn rollback_settings_after_failure'), 'settings port transaction');
check('settings page is grouped with runtime summary', indexHtml.includes('class="settings-layout"') && indexHtml.includes('class="settings-summary-grid"') && indexHtml.includes('id="settingsRuntimeSummary"') && indexHtml.includes('id="settingsReliabilitySummary"') && indexHtml.includes('高级运行时') && appJs.includes('settingsRuntimeSummary') && appJs.includes('settingsReliabilitySummary') && stylesCss.includes('.settings-section') && stylesCss.includes('.settings-summary-grid'), 'settings grouped layout');
check('navigation pages are present', ['home', 'nodes', 'connections', 'profiles', 'diagnostics', 'logs', 'settings'].every((page) => indexHtml.includes(`data-page="${page}"`) && indexHtml.includes(`data-page-panel="${page}"`)), 'all primary pages');
check('TUN switch exists in settings UI', indexHtml.includes('id="tunToggle"') && appJs.includes("['tunToggle', 'tunEnabled']"), 'tunToggle');
check('TUN switch exists on home UI', indexHtml.includes('id="tunHomeToggle"') && appJs.includes("['tunHomeToggle', 'tunEnabled']"), 'tunHomeToggle');
check('sidebar duplicate profile card is removed', !/<section class="profile">/.test(indexHtml), 'no sidebar profile block');
check('home nodes use table rows', appJs.includes('class="row home-row') && !appJs.includes('class="home-node'), 'home-row renderer');
check('home endpoint line is removed', !indexHtml.includes('id="nodeHost"'), 'no nodeHost line');
check('home drag regions are declared', (indexHtml.match(/data-tauri-drag-region/g) || []).length >= 2, 'titlebar and brand drag regions');
check('quick actions have compact subscription menu', (indexHtml.match(/id="quick[A-Za-z]+Btn"/g) || []).length >= 7 && indexHtml.includes('id="quickProfileBtn"') && indexHtml.includes('id="profileMenu"') && !indexHtml.includes('id="quickTunBtn"') && !indexHtml.includes('id="quickCopyProxyBtn"') && appJs.includes('function renderQuickProfileMenu') && appJs.includes('function toggleProfileMenu') && interactionSmoke.includes('quick subscription menu did not open'), 'quick subscription menu');
check('region filters live with home node table', indexHtml.includes('id="homeRegionRow"') && indexHtml.indexOf('id="homeRegionRow"') > indexHtml.indexOf('class="home-nodes'), 'region-row in home nodes');
check('home node mode filters are present', ['frequent', 'favorite', 'region', 'fixed'].every((mode) => indexHtml.includes(`data-home-mode="${mode}"`)) && appJs.includes('homeNodeMode') && appJs.includes('compareHomeRows') && appJs.includes("homeNodeMode === 'frequent'") && interactionSmoke.includes('home node mode buttons did not render'), 'home node modes');
check('manual fixed nodes are editable and persisted', mainRs.includes('manual_nodes') && mainRs.includes('fn save_manual_node') && mainRs.includes('fn apply_manual_nodes') && mainRs.includes('insert_manual_node_into_config') && indexHtml.includes('id="nodeEditorOverlay"') && indexHtml.includes('id="addFixedNodeBtn"') && appJs.includes("invoke('save_manual_node'") && appJs.includes('collectNodeEditorPayload') && interactionSmoke.includes('fixed node editor did not save through backend command'), 'manual fixed nodes');
check('protocol UI does not display core name', indexHtml.includes('id="protocolState"') && indexHtml.includes('id="protocolMetric"') && !indexHtml.includes('>mihomo<'), 'protocolState/protocolMetric');
check('Rust window controls are wired', ['window_minimize', 'window_toggle_maximize', 'window_close'].every((name) => mainRs.includes(name) && appJs.includes(name)), 'window commands');
check('native window drag ACL is explicit and non-duplicated', capabilitiesJson.includes('core:window:allow-start-dragging') && indexHtml.includes('data-tauri-drag-region') && !appJs.includes('window_start_dragging') && !mainRs.includes('fn window_start_dragging'), 'native drag-region permission');
check('admin relaunch command is wired', mainRs.includes('fn relaunch_as_admin') && indexHtml.includes('id="elevateBtn"') && appJs.includes("invoke('relaunch_as_admin'"), 'relaunch_as_admin');
check('advanced settings save uses one background batch job', mainRs.includes('fn update_settings') && mainRs.includes('updateSettings') && appJs.includes('updateSettingsJob') && interactionSmoke.includes("args.kind === 'updateSettings'"), 'updateSettings');
check('speed tests use background progress commands', mainRs.includes('fn start_proxy_delay_test') && mainRs.includes('fn speed_test_status') && appJs.includes("invoke('start_proxy_delay_test'") && appJs.includes("invoke('speed_test_status'") && interactionSmoke.includes("command === 'start_proxy_delay_test'"), 'async speed test');
check('home recommendation action is compact and non-duplicated', indexHtml.includes('class="recommend-compact"') && indexHtml.includes('class="recommend-inline"') && indexHtml.includes('id="switchRecommendedBtn"') && indexHtml.includes('class="recommend-switch"') && indexHtml.includes('id="recommendedNodeName"') && !indexHtml.includes('id="recommendedNodeRegion"') && !indexHtml.includes('id="currentNodeName"') && !indexHtml.includes('id="bestNodeList"') && !indexHtml.includes('class="best-node"') && appJs.includes('function renderHomeNodeSummary'), 'compact recommendation action');
check('speed test does not switch proxies', testNodesBody.includes("invoke('start_proxy_delay_test'") && !testNodesBody.includes("runBackgroundJob('changeProxy'") && !testNodesBody.includes('selectBestProxyJob') && interactionSmoke.includes('speed test triggered a proxy switch'), 'test only updates delay/recommendation');
check('home low-value recommendation metrics are replaced', indexHtml.includes('id="systemProxyMetric"') && indexHtml.includes('id="upRate"') && indexHtml.includes('id="downRate"') && !indexHtml.includes('id="tunMetric"') && !indexHtml.includes('id="adminMetric"') && !indexHtml.includes('class="side-card traffic-card"') && appJs.includes("classList.toggle('is-danger'") && interactionSmoke.includes('disabled system proxy metric is not highlighted'), 'runtime metrics replace duplicate recommendation metrics');
check('automatic strategy group warning is wired', indexHtml.includes('id="autoGroupNotice"') && indexHtml.includes('id="lockAutoGroupBtn"') && appJs.includes('function isAutoStrategyGroup') && appJs.includes('function lockAutoGroupJob') && interactionSmoke.includes('automatic strategy group warning did not render'), 'auto strategy warning/lock');
check('node row actions are wired and spaced', mainRs.includes('fn test_single_proxy_delay') && appJs.includes("data-node-action=\"test\"") && appJs.includes("data-node-action=\"edit\"") && appJs.includes("data-node-action=\"favorite\"") && appJs.includes("invoke('test_single_proxy_delay'") && stylesCss.includes('scrollbar-gutter: stable') && stylesCss.includes('116px') && indexHtml.includes('row-action-labels') && interactionSmoke.includes('node status column was not removed'), 'row action buttons');
check('speed tests stream completed nodes quickly', mainRs.includes('mpsc::channel') && mainRs.includes('speed_test_phases') && mainRs.includes('Arc::new(client)') && mainRs.includes('speed.recommended = speed_recommendation') && appJs.includes('const speedTestPollMs = 300'), 'incremental speed test results');
check('speed tests use protocol-aware adaptive scheduling', mainRs.includes('fn protocol_concurrency') && mainRs.includes('fn speed_test_phases') && mainRs.includes('protocol_primary_timeout_ms') && mainRs.includes('"tuic" => 8') && mainRs.includes('collect_proxy_targets'), 'protocol-aware speed path');
check('Reality/Hysteria2/TUIC scheduler coverage exists', mainRs.includes('text.contains("reality")') && mainRs.includes('protocol_scheduler_handles_reality_hysteria2_and_tuic_explicitly') && mainRs.includes('protocol_concurrency("hysteria2")') && mainRs.includes('protocol_concurrency("tuic")'), 'advanced protocol scheduler tests');
check('Aegos 2.1 background job model is wired', mainRs.includes('fn start_job') && mainRs.includes('fn job_status') && mainRs.includes('fn cancel_job') && appJs.includes("invoke('start_job'") && appJs.includes("invoke('job_status'") && interactionSmoke.includes("command === 'start_job'") && interactionSmoke.includes('missingJobKinds') && mainRs.includes('updateAllProfiles') && appJs.includes('updateAllProfilesJob') && indexHtml.includes('updateAllProfilesBtn'), 'start_job/job_status');
check('background job center is visible and store-driven', indexHtml.includes('id="jobRows"') && appJs.includes('function rememberJob') && appJs.includes('function renderJobCenter') && appJs.includes('setInterval(() => syncJobCenter(false), 2500)') && appJs.includes('data-job-cancel') && appJs.includes('data-job-retry') && appJs.includes("invoke('cancel_job'") && stylesCss.includes('.job-row'), 'job center');
check('core power operations use background jobs', ['startCore', 'stopCore', 'restartCore'].every((name) => mainRs.includes(name) && appJs.includes(name) && interactionSmoke.includes(name)) && !appJs.includes("invoke('start_core'") && !appJs.includes("invoke('stop_core'") && !appJs.includes("invoke('restart_core'"), 'core power jobs');
check('profile and settings apply through background jobs', ['setActiveProfile', 'removeProfile', 'updateSettings'].every((name) => mainRs.includes(name) && appJs.includes(name) && interactionSmoke.includes(name)) && !appJs.includes("invoke('set_active_profile'") && !appJs.includes("invoke('remove_profile'") && !appJs.includes("invoke('update_settings'"), 'profile/settings jobs');
check('single setting changes use background jobs', mainRs.includes('updateSetting') && appJs.includes("runBackgroundJob('updateSetting'") && interactionSmoke.includes("args.kind === 'updateSetting'") && !appJs.includes("invoke('set_system_proxy'") && !appJs.includes("invoke('update_setting'"), 'updateSetting');
check('mode and proxy switching use background jobs', ['setMode', 'changeProxy'].every((name) => mainRs.includes(name) && appJs.includes(name) && interactionSmoke.includes(name)) && !appJs.includes("invoke('set_mode'") && !appJs.includes("invoke('change_proxy'"), 'mode/proxy jobs');
check('system proxy takeover restores previous Windows proxy', mainRs.includes('struct SystemProxySnapshot') && mainRs.includes('capture_proxy_snapshot_before_takeover') && mainRs.includes('write_windows_proxy_snapshot') && mainRs.includes('shutdown_for_exit') && mainRs.includes('"Windows System Proxy takeover"') && appJs.includes('repairSystemProxyJob') && appJs.includes("runBackgroundJob('repairSystemProxy'") && interactionSmoke.includes('repairSystemProxy'), 'proxy takeover snapshot/repair');
check('core startup failures keep diagnostics visible', mainRs.includes('fn start_failure_message') && mainRs.includes('recent_log_summary') && mainRs.includes('"Recent core logs"') && appJs.includes('lastBackgroundJobError') && appJs.includes("if (isPageActive('logs')) renderLogs()"), 'startup diagnostics');
check('diagnostics page shows severity summary and copyable report', mainRs.includes('"summary"') && mainRs.includes('"nextActions"') && mainRs.includes('"severity"') && indexHtml.includes('id="diagSummary"') && indexHtml.includes('id="copyDiagBtn"') && appJs.includes('function renderDiagnosticSummary') && appJs.includes('function renderDiagnosticRows') && appJs.includes('function diagnosticReportText') && appJs.includes('latestDiagnostics') && stylesCss.includes('.diagnostic-summary') && interactionSmoke.includes('diagnostic severity row did not render'), 'diagnostics severity UI');
check('diagnostics navigation does not auto-run heavy diagnostics', appJs.includes('function renderCachedDiagnostics') && appJs.includes('renderCachedDiagnostics();') && !appJs.includes("page === 'diagnostics' && shouldRefreshPageCache(page)) runDiagnostics") && interactionSmoke.includes('diagnostics page navigation auto-ran heavy diagnostics'), 'diagnostics runs on explicit request');
check('notice bar uses severity colors', appJs.includes('function noticeLevel') && appJs.includes("notice.classList.toggle('is-bad'") && stylesCss.includes('.notice.is-bad') && stylesCss.includes('.notice.is-warn') && stylesCss.includes('.notice.is-info'), 'notice severity colors');
check('logs are categorized and filterable without backend work', mainRs.includes('category: log_category(level, line).to_string()') && mainRs.includes('category: "core".to_string()') && indexHtml.includes('data-log-filter="core"') && appJs.includes('let logFilter =') && appJs.includes('function logCategoryLabel') && interactionSmoke.includes('log filters triggered backend calls'), 'log taxonomy/filter UI');
check('core lifecycle has failed-start cleanup and proxy-preserving restart', mainRs.includes('fn terminate_core_process') && mainRs.includes('Stopping failed mihomo startup') && mainRs.includes('fn restart_core_preserving_proxy') && mainRs.includes('fn restore_system_proxy_preference') && mainRs.includes('core.restart_core_preserving_proxy(350)'), 'core lifecycle transaction');
check('profile config preflight is wired', mainRs.includes('fn preflight_runtime_config') && mainRs.includes('fn preflight_profile_file') && mainRs.includes('"Profile preflight"') && mainRs.includes('Config preflight passed') && mainRs.includes('Profile switch preflight failed') && mainRs.includes('Profile switch failed and rolled back') && mainRs.includes('代理组引用了不存在的节点'), 'profile preflight');
check('profile preflight allows proxy groups to reference other groups', mainRs.includes('proxy_group_name_set') && mainRs.includes('proxy_group_name_set.contains(name)') && mainRs.includes('"PASS" | "COMPATIBLE"'), 'proxy group references');
check('profile switch hot reloads through mihomo safe path', mainRs.includes('fn hot_reload_profile') && mainRs.includes('fn write_runtime_profile_copy') && mainRs.includes('aegos-runtime-profile.yaml') && mainRs.includes('/configs?force=true') && mainRs.includes('Profile hot reload failed; falling back to restart'), 'profile hot reload');
check('proxy state model persists selections and resolves group references', mainRs.includes('selected_proxy_map') && mainRs.includes('fn resolve_group_leaf') && mainRs.includes('fn apply_group_resolution') && mainRs.includes('realProxyName') && mainRs.includes('.selected_proxy_map') && mainRs.includes('insert(group.to_string(), proxy.to_string())'), 'selected proxy map/group resolution');
check('digest-based config apply skip is wired', mainRs.includes('fn sha256_text') && mainRs.includes('struct RenderedProfile') && mainRs.includes('runtime_config_digest') && mainRs.includes('Profile apply skipped; unchanged runtime config digest') && mainRs.includes('"skipped": true') && mainRs.includes('runtime_config_digest_is_stable_until_settings_change'), 'digest no-op profile apply');
check('operation scheduler serializes core-changing actions', mainRs.includes('operations: Arc<Mutex<()>>') && mainRs.includes('fn lock_operation_queue') && mainRs.includes('operation_queue_is_exclusive') && ['startCore', 'stopCore', 'restartCore', 'setActiveProfile', 'updateSettings', 'updateSetting', 'setMode', 'changeProxy'].every((name) => mainRs.includes(`"${name}"`)), 'shared operation queue');
check('profile switch diagnostics and local integration coverage exist', mainRs.includes('Profile switch requested:') && mainRs.includes('Profile switch completed:') && mainRs.includes('Profile switch preflight failed for') && mainRs.includes('running_switch_preflight_accepts_two_local_profiles'), 'switch diagnostics/integration');
check('node health and best proxy recommendation engine is wired', mainRs.includes('struct NodeHealth') && mainRs.includes('fn update_node_health') && mainRs.includes('fn speed_recommendation') && mainRs.includes('lowLatency') && mainRs.includes('"selectBestProxy"') && appJs.includes("runBackgroundJob('selectBestProxy'") && interactionSmoke.includes('selectBestProxy'), 'health/recommendation engine');
check('subscription source preflight is wired', mainRs.includes('struct ProfileSourceSummary') && mainRs.includes('fn summarize_profile_source') && mainRs.includes('subscription download returned empty content') && mainRs.includes('preflight_runtime_config(&patched, &profile, &settings)?') && appJs.includes('profile-source-summary'), 'subscription preflight');
check('subscription metadata self-heals from profile files', mainRs.includes('fn profile_file_summary') && mainRs.includes('fn repair_profile_metadata') && mainRs.includes('fn public_profiles') && mainRs.includes('metadataStatus') && appJs.includes('function profileSummaryText') && appJs.includes('proxyGroupCount'), 'profile metadata self-heal');
check('subscription import/update rollback is wired', mainRs.includes('Profile import applied but startup failed; rolled back') && mainRs.includes('Profile update applied but startup failed; restored previous subscription') && mainRs.includes('Profile was removed before update completed') && mainRs.includes('let temp_path = profile_path.with_file_name'), 'subscription transaction');
check('Aegos reliability recovery is wired', mainRs.includes('fn recover_network') && mainRs.includes('fn recover_network(&mut self, force: bool)') && mainRs.includes('reliability_profile_failover') && mainRs.includes('probe_proxy_network') && appJs.includes("recoverNetworkJob") && indexHtml.includes('id="smartRecoverBtn"') && indexHtml.includes('id="reliabilityAutoToggle"'), 'recover_network');
check('click selections use shared optimistic mutation layer', appJs.includes('async function runOptimisticAction') && appJs.includes('function snapshotUiState') && appJs.includes('function restoreUiState') && appJs.includes('applyOptimisticSetting') && appJs.includes('applyOptimisticProfileRemove') && appJs.includes('const uiStore') && appJs.includes('function renderUiState') && interactionSmoke.includes('home region menu did not update through store immediately') && interactionSmoke.includes('profile row did not remove optimistically'), 'shared optimistic interaction feedback');
check('button pending feedback is non-blocking', appJs.includes('function setButtonBusy') && appJs.includes("button.classList.toggle('is-pending', busy)") && appJs.includes("button.setAttribute('aria-busy', busy ? 'true' : 'false')") && appJs.includes("button.dataset.busy = busy ? 'true' : ''") && appJs.includes("if (button?.dataset.busy === 'true') return null;") && !appJs.includes('button.disabled = busy') && stylesCss.includes('button.is-pending') && interactionSmoke.includes('button became disabled during pending feedback'), 'aria-busy/data-busy/is-pending');
check('subscription mutations show unified pending rows', appJs.includes('function applyOptimisticProfilePending') && appJs.includes('function applyOptimisticProfilesPending') && appJs.includes('function applyOptimisticProfileImport') && appJs.includes('profilePendingText') && appJs.includes("applyOptimisticProfilePending(id, 'updating')") && appJs.includes("applyOptimisticProfilesPending('updating')") && appJs.includes('applyOptimisticProfileImport(url)') && stylesCss.includes('.list-card.is-pending') && interactionSmoke.includes('profile import did not insert a pending row immediately'), 'subscription pending rows');
check('background refresh yields to foreground and background jobs', appJs.includes('foregroundBusy') && appJs.includes('backgroundJobBusy') && appJs.includes('runForegroundAction') && appJs.includes('runBackgroundJob') && appJs.includes('if (!force && (foregroundBusy > 0 || backgroundJobBusy > 0)) return') && appJs.includes('if (foregroundBusy > 0 || backgroundJobBusy > 0) return;'), 'foreground/background scheduler');
check('sidebar navigation is immediate and deferred-load', appJs.includes('pointerdown') && appJs.includes('schedulePageLoad') && appJs.includes('pageLoadToken') && appJs.includes('renderedPage') && appJs.includes('scheduleRowsRender') && stylesCss.includes('.nav {\n  display: grid;\n  gap: 6px;\n  contain: layout paint;'), 'deferred nav load');
check('rapid sidebar navigation stress coverage exists', perfSmoke.includes('i < 420') && perfSmoke.includes('finalRapidPage') && perfSmoke.includes('button.click()') && perfSmoke.includes('rapid navigation triggered diagnostics before quiet period'), '420 rapid nav switches');
check('page switching hides inactive pages from layout', pageStyleBlock.includes('position: absolute') && pageStyleBlock.includes('display: none') && stylesCss.includes('.page.active') && stylesCss.includes('display: grid') && appJs.includes('pageNavSettleMs') && appJs.includes('pageCacheState'), 'inactive pages do not participate in layout');
check('large node lists are windowed and debounced', appJs.includes('nodeRenderLimit = 36') && appJs.includes('homeNodeRenderLimit = 8') && appJs.includes('rowRenderSettleMs = 320') && appJs.includes('nodeRows.length < nodeRenderLimit') && appJs.includes('matchingNodeCount'), 'windowed node rendering');
check('delay UI uses 100 ms low-latency threshold', appJs.includes('Number(delay) < 100') && appJs.includes('delay-good') && appJs.includes('delay-bad') && stylesCss.includes('.delay-good') && stylesCss.includes('.delay-bad'), 'delay threshold colors');
check('subscription URI parser is available', mainRs.includes('parse_uri_subscription') && mainRs.includes('base64'), 'URI/base64 subscriptions');
check('TUIC URI subscriptions are supported', mainRs.includes('parse_tuic_uri') && mainRs.includes('line.starts_with("tuic://")'), 'tuic:// parser');
check('traffic stream uses snapshot reader', mainRs.includes('fn traffic_snapshot') && !mainRs.includes('controller("GET", "/traffic"'), '/traffic snapshot');
check('status heartbeat is lightweight', statusBody.includes('traffic_snapshot(120)') && statusBody.includes('"version": JsonValue::Null') && statusBody.includes('recent_logs(120)') && !statusBody.includes('"/version"'), 'app_status snapshot');
check('release notes exist for package version', exists(releaseDoc), releaseDoc);
if (exists(releaseDoc)) {
  const notes = releaseNotes;
  check('release notes include verification and artifact hash', notes.includes('## Verification') && notes.includes('## Artifact') && notes.includes('SHA-256'), releaseDoc);
  check('release notes hash matches installer or marks source-only', sourceOnlyRelease || (Boolean(installerSha) && notes.includes(installerSha)), installerSha || 'source-only');
}

const result = {
  ok: fail.length === 0,
  failed: fail,
  passed: pass,
  installer: exists(installer) ? {
    path: installer,
    size: fs.statSync(path.join(root, installer)).size,
    sha256: installerSha
  } : null,
  generatedAt: new Date().toISOString()
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
