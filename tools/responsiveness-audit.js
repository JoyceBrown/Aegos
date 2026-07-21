import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appJs = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const mainRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
const coreRuntimeRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'core_runtime.rs'), 'utf8');
const perfSmoke = fs.readFileSync(path.join(root, 'tools', 'perf-smoke.js'), 'utf8');
const interactionSmoke = fs.readFileSync(path.join(root, 'tools', 'interaction-smoke.js'), 'utf8');
const releaseAudit = fs.readFileSync(path.join(root, 'tools', 'release-audit.js'), 'utf8');

const fail = [];
const pass = [];

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

function bodyOf(name) {
  const match = appJs.match(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`));
  return match?.[1] || '';
}

const setPageBody = bodyOf('setPage');
const schedulePageLoadBody = bodyOf('schedulePageLoad');
const runWhenIdleBody = bodyOf('runWhenIdle');
const scheduleRowsRenderBody = bodyOf('scheduleRowsRender');
const testNodesBody = bodyOf('testNodes');
const pollSpeedBody = bodyOf('pollSpeedTest');
const renderStatusStart = appJs.indexOf('function renderStatus(status)');
const renderStatusEnd = appJs.indexOf('function applyOptimisticMode', renderStatusStart);
const renderStatusBody = renderStatusStart >= 0 && renderStatusEnd > renderStatusStart
  ? appJs.slice(renderStatusStart, renderStatusEnd)
  : '';

check(
  'sidebar navigation updates active page synchronously and defers heavy loads',
  setPageBody.includes('uiStore.set({ page: next })') &&
    setPageBody.includes('schedulePageLoad(next)') &&
    schedulePageLoadBody.includes('pageNavSettleMs') &&
    schedulePageLoadBody.includes('runWhenIdle') &&
    schedulePageLoadBody.includes('if (foregroundBusy > 0) return') &&
    !setPageBody.includes("invoke('") &&
    !setPageBody.includes('await '),
  'clicking navigation must feel instant'
);

check(
  'background work yields to foreground and other background jobs',
  appJs.includes('let foregroundBusy = 0') &&
    appJs.includes('let backgroundJobBusy = 0') &&
    schedulePageLoadBody.includes('if (foregroundBusy > 0) return') &&
    runWhenIdleBody.includes('setTimeout(task, 0)') &&
    appJs.includes('if (!force && (foregroundBusy > 0 || backgroundJobBusy > 0)) return'),
  'refresh loops should not fight active user operations'
);

check(
  'status rendering stays pure and never starts heavy backend work',
  renderStatusBody.includes('statusSurfaceNotice(status, settings, protection, availability)') &&
    !renderStatusBody.includes("invoke('") &&
    !renderStatusBody.includes('runDiagnostics(') &&
    !renderStatusBody.includes('testNodes(') &&
    !renderStatusBody.includes('refreshOutboundIp') &&
    !renderStatusBody.includes('refreshEnvironmentReadiness('),
  'renderStatus must only paint the latest snapshot'
);

check(
  'unchanged status heartbeats avoid hidden-page repaint work',
  renderStatusBody.includes('if (!fullRender)') &&
    renderStatusBody.includes("if (isPageActive('home')) renderHomeNodeSummary()") &&
    renderStatusBody.includes("if (isPageActive('nodes')) renderNodeGroupSwitcher()") &&
    renderStatusBody.includes("if (isPageActive('settings')) renderSettings(status)") &&
    !renderStatusBody.includes('warmStaticPageCaches()') &&
    appJs.includes('function statusUiSignature') &&
    appJs.includes('function renderTrafficMetrics'),
  'periodic status updates may repaint only changed traffic or the visible page'
);

check(
  'visible page reconciliation is coalesced to the final animation frame',
  setPageBody.includes('scheduleVisiblePagePaint(next)') &&
    appJs.includes('if (pagePaintFrame) cancelAnimationFrame(pagePaintFrame)') &&
    appJs.includes('pagePaintFrame = requestAnimationFrame') &&
    setPageBody.includes('delay: 16'),
  'rapid navigation must cancel work for pages the user never settled on'
);

check(
  'status controller and LAN probes stay off the CoreManager and UI critical paths',
  mainRs.includes('fn status_observation(') &&
    mainRs.includes('fn status_from_observed_traffic(') &&
    /let observed_traffic\s*=\s*controller\s*\.status_traffic_snapshot_or_idle/.test(mainRs) &&
    mainRs.includes('fn refresh_lan_ip_detached(') &&
    mainRs.includes('refresh_lan_ip_detached(app.clone(), Arc::clone(&state.core))') &&
    mainRs.includes('fn refresh_elevation_detached(app: AppHandle)') &&
    mainRs.includes('thread::sleep(Duration::from_millis(1800))') &&
    mainRs.includes('cached_process_elevated().unwrap_or(false)') &&
    mainRs.includes('fn run_powershell_with_timeout') &&
    mainRs.includes('child.try_wait()') &&
    mainRs.includes('started.elapsed() >= timeout') &&
    mainRs.includes('run_powershell_with_timeout(&script, Duration::from_secs(3))') &&
    coreRuntimeRs.includes("Get-Process -Name {process_name_literal}") &&
    !coreRuntimeRs.includes('Get-CimInstance Win32_Process -Filter "Name = {binary_literal}"') &&
    !mainRs.includes('let refreshed_lan_ip = refresh_lan_ip.then(primary_lan_ip)') &&
    appJs.includes("listen('aegos-runtime-status'") &&
    mainRs.includes('core.status_from_observed_traffic('),
  'slow controller or PowerShell reads cannot hold the global core mutex or delay first status paint'
);

check(
  'large static surfaces avoid continuous backdrop blur composition',
  /\.panel,\r?\n\.side-card,\r?\n\.sidebar\s*\{[\s\S]*?backdrop-filter:\s*none;/.test(styles),
  'static panels use preblended surfaces; blur remains limited to transient overlays'
);

check(
  'settings page heavy checks are explicit, cached, and detached from navigation',
  appJs.includes('settings: 30000') &&
    appJs.includes('settings: { loaded: false, loading: false, updatedAt: 0 }') &&
    schedulePageLoadBody.includes("page === 'settings' && shouldRefreshPageCache(page)") &&
    schedulePageLoadBody.includes('renderEnvironmentReadiness()') &&
    schedulePageLoadBody.includes("markPageCache(page)") &&
    !schedulePageLoadBody.includes('refreshEnvironmentReadiness') &&
    !schedulePageLoadBody.includes('refreshIpv6DnsSafety') &&
    appJs.includes('function refreshSettingsChecks') &&
    !setPageBody.includes('refreshEnvironmentReadiness') &&
    !setPageBody.includes('refreshIpv6DnsSafety'),
  'opening or leaving settings must not launch PowerShell and network probes'
);

check(
  'large node lists are cached, frame-coalesced, and rendered only on visible surfaces',
  appJs.includes('nodeRowStaticCache') &&
    appJs.includes('function normalizeNodeItemCached') &&
    appJs.includes('nodeRowStaticCache.set(cacheKey, cached)') &&
    scheduleRowsRenderBody.includes('rowRenderSettleMs') &&
    scheduleRowsRenderBody.includes('requestAnimationFrame(run)') &&
    scheduleRowsRenderBody.includes('if (delay > 16) rowRenderTimer = setTimeout(run, delay)') &&
    scheduleRowsRenderBody.includes('if (!options.force && !isNodeSurfaceActive()) return') &&
    appJs.includes('function summaryRowsFromLatestGroup(limit = 160)') &&
    appJs.includes('nodeDirectRenderLimit = 240') &&
    appJs.includes('function renderNodeVirtualWindow') &&
    appJs.includes('function scheduleNodeVirtualWindowRender') &&
    appJs.includes('rows.length > nodeDirectRenderLimit') &&
    appJs.includes('rows.slice(start, end).map') &&
    appJs.includes("addEventListener('scroll', scheduleNodeVirtualWindowRender") &&
    appJs.includes('homeNodeRenderLimit') &&
    appJs.includes('function renderRows') &&
    perfSmoke.includes('allNodesReachable') &&
    perfSmoke.includes('visibleRows > 100'),
  'node table DOM must stay bounded while the complete matching collection remains scroll-reachable'
);

check(
  'navigation and node rendering expose read-only timing evidence for real WebView2 probes',
  appJs.includes('function recordUiPerformance') &&
    appJs.includes('window.__aegosPerformanceSnapshot = uiPerformanceSnapshot') &&
    appJs.includes("recordUiPerformance('navigation-request'") &&
    appJs.includes("recordUiPerformance('navigation-painted'") &&
    appJs.includes("recordUiPerformance('node-rows-rendered'") &&
    appJs.includes("recordUiPerformance('invoke-finish'"),
  'actual WebView2 timing must be observable without turning on a user-facing debug mode'
);

check(
  'speed tests do not enter global foreground busy state',
  testNodesBody.includes('speedTestStarting = true') &&
    testNodesBody.includes("invoke('start_proxy_delay_test'") &&
    !testNodesBody.includes('runForegroundAction') &&
    !testNodesBody.includes('foregroundBusy') &&
    pollSpeedBody.includes("speedEventReady ? 'speed_test_progress' : 'speed_test_status'") &&
    pollSpeedBody.includes('applySpeedStatusToNodes(displayStatus') &&
    pollSpeedBody.includes('refreshVisibleNodesForSpeed(!status.running, changed)') &&
    appJs.includes('function applySpeedStatusToNodes') &&
    appJs.includes('updateVisibleNodeDelays(visibleChanges)'),
  'measurement can run while the user continues using the app'
);

check(
  'diagnostics, menus, filters, and log tabs are covered by interaction smoke',
    interactionSmoke.includes('running diagnostics blocked sidebar page switching') &&
    interactionSmoke.includes('speed test blocked sidebar page switching') &&
    interactionSmoke.includes('quick subscription menu did not close on second click') &&
    interactionSmoke.includes('quick subscription menu was covered by another layer') &&
    interactionSmoke.includes('log filters triggered backend calls') &&
    interactionSmoke.includes('home filter switch left rows stuck in testing state after speed test'),
  'high-friction user paths have regression coverage'
);

check(
  'performance smoke stresses rapid nav, menus, filters, and large node lists',
  perfSmoke.includes('Array.from({ length: 8000 }') &&
    perfSmoke.includes('i < 420') &&
    perfSmoke.includes('navigation too slow') &&
    perfSmoke.includes('menu toggles triggered backend calls') &&
    perfSmoke.includes('filter/search interactions triggered backend calls') &&
    perfSmoke.includes('longTaskBudget') &&
    perfSmoke.includes('long tasks exceeded budget') &&
    perfSmoke.includes('p95FrameMs') &&
    perfSmoke.includes('unexpectedLayoutShift') &&
    perfSmoke.includes('rapid navigation frame pacing regressed'),
  'perf smoke models the user complaints directly'
);

check(
  'release audit keeps responsiveness rules visible in the global gate',
  releaseAudit.includes('background refresh yields to foreground and background jobs') &&
    releaseAudit.includes('sidebar navigation is immediate and deferred-load') &&
    releaseAudit.includes('rapid sidebar navigation stress coverage exists') &&
    releaseAudit.includes('large node lists are complete, virtualized, frame-coalesced, and row-cached') &&
    releaseAudit.includes('speed testing does not block sidebar page switching'),
  'global release gate must keep responsiveness from regressing'
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
