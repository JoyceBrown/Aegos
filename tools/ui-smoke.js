import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const chromeCandidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.CHROME_PATH
].filter(Boolean);

const chromePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
if (!chromePath) {
  throw new Error('Chrome not found. Set CHROME_PATH or install Chrome for UI smoke checks.');
}
if (typeof WebSocket === 'undefined') {
  throw new Error('This Node.js runtime does not expose global WebSocket.');
}

const port = 9333 + Math.floor(Math.random() * 500);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegos-ui-smoke-'));
const appUrl = pathToFileURL(path.join(root, 'src', 'index.html')).href;
const screenshotDir = path.join(root, 'ui-smoke');
fs.mkdirSync(screenshotDir, { recursive: true });

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function terminateTestChromeProcesses(dir) {
  if (process.platform !== 'win32') return;
  const escapedDir = dir.replaceAll("'", "''");
  const query = `Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*${escapedDir}*' } | ForEach-Object { $_.ProcessId }`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], {
    encoding: 'utf8',
    windowsHide: true
  });
  for (const pid of String(result.stdout || '').match(/\d+/g) || []) {
    spawnSync('taskkill.exe', ['/PID', pid, '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  }
}

async function removeTestUserDataDir(dir) {
  const deadline = Date.now() + 15000;
  let absentSince = 0;
  do {
    terminateTestChromeProcesses(dir);
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
    } catch {}
    if (!fs.existsSync(dir)) {
      if (!absentSince) absentSince = Date.now();
      if (Date.now() - absentSince >= 1000) return true;
    } else {
      absentSince = 0;
    }
    await delay(200);
  } while (Date.now() < deadline);
  return !fs.existsSync(dir);
}

function httpJson(route, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: route, method }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(new Error(`Invalid JSON from ${route}: ${err.message}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitForChrome() {
  for (let i = 0; i < 80; i += 1) {
    try {
      return await httpJson('/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error('Chrome DevTools endpoint did not start.');
}

function createCdpClient(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          id += 1;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((sendResolve, sendReject) => {
            pending.set(id, { resolve: sendResolve, reject: sendReject });
          });
        },
        close() {
          socket.close();
        }
      });
    }, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
}

async function openPage() {
  const target = await httpJson(`/json/new?${encodeURIComponent(appUrl)}`, 'PUT');
  return createCdpClient(target.webSocketDebuggerUrl);
}

async function evaluate(page, expression) {
  const result = await page.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
  }
  return result.result.value;
}

async function waitForAegosUi(page) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = await evaluate(page, `Boolean(
      document.readyState === 'complete' &&
      document.querySelector('#homeNodeRows .row') &&
      document.querySelector('#settingsPortSummary')?.textContent?.trim()
    )`);
    if (ready) return;
    await delay(125);
  }
  throw new Error('Aegos UI did not reach the mocked ready state.');
}

async function auditViewport(page, width, height, deviceScaleFactor = 1) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor,
    mobile: false
  });
  await page.send('Page.navigate', { url: appUrl });
  await waitForAegosUi(page);

  const report = await evaluate(page, `(async () => {
    const box = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const all = (selector) => [...document.querySelectorAll(selector)];
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const waitForSelector = async (selector, timeoutMs = 1200) => {
      const startedAt = performance.now();
      while (performance.now() - startedAt < timeoutMs) {
        const element = document.querySelector(selector);
        if (element) return element;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return null;
    };
    const collectBase = () => {
      const overflowX = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth;
      const textOverflow = all('button, .notice, h1, .metric-grid strong, .switch-row b').filter((el) => visible(el) && el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent.trim());
      const badPanels = all('.panel').filter((el) => visible(el) && (() => {
        const r = el.getBoundingClientRect();
        return r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1;
      })()).map((el) => el.className);
      return { overflowX, textOverflow, badPanels };
    };
    const homeBase = collectBase();
    const quickEscapes = all('.quick-row button').filter((el) => {
      const r = el.getBoundingClientRect();
      const parent = el.closest('.quick').getBoundingClientRect();
      return visible(el) && (r.left < parent.left - 1 || r.right > parent.right + 1 || r.height > 36);
    }).map((el) => el.textContent.trim());
    const metricIcons = all('.metric-icon').map((el) => el.getBoundingClientRect().width);
    const homeRows = all('#homeNodeRows .row').filter(visible).length;
    const activeHomeRegion = document.querySelector('[data-region].active')?.dataset.region || '';
    const regionBox = box('.region-row');
    const homeHeadBox = box('.home-row-head');
    const firstHomeRowBox = box('#homeNodeRows .row');
    const homeNodeLayout = regionBox && homeHeadBox && firstHomeRowBox ? {
      regionToHeadGap: homeHeadBox.top - regionBox.bottom,
      headToFirstRowGap: firstHomeRowBox.top - homeHeadBox.bottom,
      headHeight: homeHeadBox.height,
      firstRowTop: firstHomeRowBox.top,
      firstRowHeight: firstHomeRowBox.height
    } : null;
    const tunHome = document.querySelector('#tunHomeToggle');
    const tunHomeVisible = Boolean(tunHome && visible(tunHome));
    const tunHomeControl = document.querySelector('.tun-home-toggle');
    const tunHomeControlRect = tunHomeControl?.getBoundingClientRect();
    const tunHomeRect = tunHome?.getBoundingClientRect();
    const tunHomeCenterOffset = tunHomeControlRect && tunHomeRect
      ? Math.abs((tunHomeControlRect.top + tunHomeControlRect.height / 2) - (tunHomeRect.top + tunHomeRect.height / 2))
      : null;
    const homeTunTextRemoved = !document.querySelector('#tunHomeState') && !tunHomeControl?.textContent.includes('未开启');
    const regionRow = document.querySelector('#homeRegionRow');
    const extraRegions = ['DE', 'FR', 'CA', 'AU', 'BR'].map((code) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.region = code;
      button.innerHTML = '<b>' + code + '</b><span class="region-label">扩展地区</span>';
      regionRow?.append(button);
      return button;
    });
    if (regionRow) regionRow.style.setProperty('--home-region-count', String(regionRow.children.length));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const regionRowRect = regionRow?.getBoundingClientRect();
    const regionOverflowActive = Boolean(regionRow && regionRow.scrollWidth > regionRow.clientWidth + 1);
    const regionOverflowContained = Boolean(
      regionRow &&
      regionRowRect.left >= -1 &&
      regionRowRect.right <= window.innerWidth + 1 &&
      (!regionOverflowActive || ['auto', 'scroll'].includes(getComputedStyle(regionRow).overflowX))
    );
    extraRegions.forEach((button) => button.remove());
    if (regionRow) regionRow.style.setProperty('--home-region-count', String(regionRow.children.length));
    const visibleQuickButtons = all('[data-quick-action]').filter(visible);
    const quickActionWidths = visibleQuickButtons.map((button) => button.getBoundingClientRect().width);
    const firstQuickButtonRect = visibleQuickButtons[0]?.getBoundingClientRect();
    const quickTunRowOffset = firstQuickButtonRect && tunHomeControlRect
      ? Math.abs((firstQuickButtonRect.top + firstQuickButtonRect.height / 2) - (tunHomeControlRect.top + tunHomeControlRect.height / 2))
      : null;
    const quickHeadingRemoved = !document.querySelector('.node-quick-actions .action-row > strong');
    const quickIconTextGrouped = visibleQuickButtons.every((button) => {
      const iconRect = button.querySelector('.aegos-icon')?.getBoundingClientRect();
      const labelRect = button.querySelector('.quick-action-label')?.getBoundingClientRect();
      return iconRect && labelRect && labelRect.left - iconRect.right >= 4 && labelRect.left - iconRect.right <= 12;
    });
    const quickActionsRespectLimit = visibleQuickButtons.length >= 1 && visibleQuickButtons.length <= 4;
    const topDragBox = box('.edge-drag-top');
    const titlebarStatusBox = box('#titlebarStatusCenterBtn');
    const topDragOverlapsStatus = topDragBox && titlebarStatusBox ? topDragBox.right > titlebarStatusBox.left + 1 : false;
    const nodeStatusCardBox = box('.node-status-card');
    const nodeStatusRows = all('.node-status-card > article').filter(visible).length;
    const nodeStatusFontSize = parseFloat(getComputedStyle(document.querySelector('.node-status-card small')).fontSize);
    const outboundMetric = document.querySelector('#outboundMetric');
    const outboundIpFits = Boolean(outboundMetric && outboundMetric.scrollWidth <= outboundMetric.clientWidth + 1);
    const windowActionsBox = box('.window-actions');
    const modeButtonBox = box('#modeBtn');
    const addFixedActionHiddenOutsidePage = !visible(document.querySelector('#addFixedNodeBtn'));
    document.querySelector('[data-home-mode="fixed"]')?.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const addFixedButtonBox = box('#addFixedNodeBtn');
    const fixedNodeHeaderBox = box('.home-filter-head');
    document.querySelector('[data-home-mode="region"]')?.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const homeNameColumnBox = box('.home-row-head > :nth-child(3)');
    const homeStatusColumnBox = box('.home-row-head > :nth-child(5)');
    const homeStatusValueBox = box('#homeNodeRows .row > :nth-child(5)');
    const homeStatusRightOffset = homeStatusColumnBox && homeStatusValueBox
      ? Math.abs(homeStatusColumnBox.right - homeStatusValueBox.right)
      : null;
    const sidebarBox = box('.sidebar');
    const homeHeroBox = box('.hero');
    const homeQuickBox = box('.quick');
    const homeNodesBox = box('.nodes');
    const homeRingWidth = box('.ring')?.width || 0;
    const contentCenter = (selector) => {
      const boxes = all(selector).filter((el) => visible(el) && !el.classList.contains('hidden')).map((el) => el.getBoundingClientRect());
      if (!boxes.length) return null;
      const top = Math.min(...boxes.map((r) => r.top));
      const bottom = Math.max(...boxes.map((r) => r.bottom));
      return (top + bottom) / 2;
    };
    const heroCenterOffset = Math.abs((contentCenter('.connect-column > *') || 0) - (contentCenter('.node-column > *') || 0));
    const statusTrigger = document.querySelector('#titlebarStatusCenterBtn');
    statusTrigger.focus();
    statusTrigger.click();
    const statusCenterPanelBox = box('#statusCenterPanel');
    const statusCenterRowsWrapped = all('#statusCenterPanel .status-card dl div').filter((el) => visible(el) && el.getBoundingClientRect().height > 34).map((el) => el.textContent.trim());
    const statusCenterOpen = !document.querySelector('#statusCenterOverlay')?.classList.contains('hidden');
    const statusCenterFocusEntered = document.activeElement?.id === 'closeStatusCenterBtn';
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const statusCenterClosed = document.querySelector('#statusCenterOverlay')?.classList.contains('hidden') || false;
    const statusCenterFocusRestored = document.activeElement?.id === 'titlebarStatusCenterBtn';
    document.querySelector('[data-page="nodes"]').click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const nodeBase = collectBase();
    const table = document.querySelector('.node-table')?.getBoundingClientRect();
    const tableEl = document.querySelector('.node-table');
    const visibleRows = table ? all('#nodeRows .row').filter((row) => {
      const r = row.getBoundingClientRect();
      return r.bottom > table.top && r.top < table.bottom;
    }).length : 0;
    const nodeToolbarPrimary = box('.node-toolbar-primary');
    const nodeFilterTabs = box('.node-filter-tabs');
    const nodeToolbarSplit = Boolean(
      nodeToolbarPrimary
      && nodeFilterTabs
      && nodeToolbarPrimary.bottom <= nodeFilterTabs.top + 1
    );
    document.querySelector('[data-page="connections"]').click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const connectionRows = all('#connectionRows .simple-row').filter(visible);
    const connectionActionIssues = connectionRows.flatMap((row, index) => {
      const actionBox = row.querySelector('.connection-actions')?.getBoundingClientRect();
      const buttons = all('button', row).filter(visible).map((button) => button.getBoundingClientRect());
      const rowBox = row.getBoundingClientRect();
      const actionEscapes = !actionBox || actionBox.left < rowBox.left - 1 || actionBox.right > rowBox.right + 1;
      const buttonEscapes = buttons.some((button) => button.left < actionBox.left - 1 || button.right > actionBox.right + 1 || button.width < 50);
      return actionEscapes || buttonEscapes ? ['connection-' + index] : [];
    });
    document.querySelector('[data-page="routing"]').click();
    await waitForSelector('#routingDraftListCard');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const routingBase = collectBase();
    const routingDraftCardHidden = document.querySelector('#routingDraftListCard')?.classList.contains('hidden') || false;
    const routingSummaryDetailHidden = document.querySelector('#routingSummaryDetail')?.classList.contains('hidden') || false;
    const routingSummaryHidden = !visible(document.querySelector('.routing-summary'));
    const routingKindButtons = all('[data-routing-kind]').filter(visible);
    const routingKindBoxes = routingKindButtons.map((button) => button.getBoundingClientRect());
    const routingKindsVertical = routingKindBoxes.length === 4
      && routingKindBoxes[1].top >= routingKindBoxes[0].bottom - 1
      && routingKindBoxes[2].top >= routingKindBoxes[1].bottom - 1
      && routingKindBoxes[3].top >= routingKindBoxes[2].bottom - 1;
    const routingActivePanels = all('[data-routing-panel].is-active').filter(visible).length;
    const routingAssistantHeadMissing = !document.querySelector('.routing-assistant-head');
    const routingToolbarMissing = !document.querySelector('.routing-draft-toolbar');
    document.querySelector('[data-page="profiles"]').click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const profileBase = collectBase();
    const profileTableHead = box('.profile-table-head');
    const profileTableRow = box('#profileRows .profile-table-row');
    const profileRows = document.querySelector('#profileRows');
    const profileTableOverflowX = profileRows ? profileRows.scrollWidth - profileRows.clientWidth : 0;
    const profileRowBoxes = all('#profileRows .profile-table-row').map((row) => row.getBoundingClientRect());
    const profileRowLayoutIssues = all('#profileRows .profile-table-row').flatMap((row, index) => {
      const rowBox = row.getBoundingClientRect();
      const statusBox = row.querySelector('.profile-status-column')?.getBoundingClientRect();
      const actionsBox = row.querySelector('.card-actions')?.getBoundingClientRect();
      const childrenEscape = [...row.children].filter(visible).some((child) => {
        const childBox = child.getBoundingClientRect();
        return childBox.top < rowBox.top - 1 || childBox.bottom > rowBox.bottom + 1;
      });
      const columnsOverlap = statusBox && actionsBox && statusBox.width > 0 && actionsBox.width > 0
        && statusBox.right > actionsBox.left + 1;
      return childrenEscape || columnsOverlap ? ['row-' + index] : [];
    });
    for (let index = 1; index < profileRowBoxes.length; index += 1) {
      if (profileRowBoxes[index - 1].bottom > profileRowBoxes[index].top + 1) {
        profileRowLayoutIssues.push('row-overlap-' + index);
      }
    }
    const profileInvalidCopy = [
      '\u672a\u63d0\u4f9b\u6d41\u91cf\u4e0e\u5230\u671f\u4fe1\u606f',
      '\u5c1a\u672a\u68c0\u6d4b',
      '178',
      'profile-file'
    ].filter((text) => profileRows?.textContent.includes(text));
    const profileWrappedActions = all('#profileRows .profile-enable-button')
      .filter(visible)
      .filter((button) => button.getBoundingClientRect().height > 34 || button.scrollWidth > button.clientWidth + 1)
      .map((button) => button.closest('[data-profile-row]')?.dataset.profileRow || 'unknown');
    document.querySelector('[data-page="settings"]').click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const settingsBase = collectBase();
    const settingsPanel = document.querySelector('[data-page-panel="settings"]');
    const tunToggle = document.querySelector('#tunToggle');
    const settingsActive = settingsPanel?.classList.contains('active') || false;
    const tunToggleVisible = Boolean(tunToggle && visible(tunToggle));
    const settingsBox = box('[data-page-panel="settings"] .page-card');
    const settingsSummaryHidden = !visible(document.querySelector('[data-page-panel="settings"] .settings-summary-grid'));
    const settingsCategoryCount = all('[data-settings-category]').filter(visible).length;
    const settingsVisiblePanels = all('[data-settings-panel].active').filter(visible).length;
    const settingsNavBox = box('.settings-category-nav');
    const settingsContentBox = box('.settings-category-content');
    const settingsWorkspaceAligned = Boolean(
      settingsNavBox
      && settingsContentBox
      && settingsNavBox.right <= settingsContentBox.left + 1
      && Math.abs(settingsNavBox.top - settingsContentBox.top) <= 4
    );
    const primaryStyle = getComputedStyle(document.querySelector('button.primary'));
    const primaryUsesGradient = primaryStyle.backgroundImage !== 'none';
    const primaryRadius = parseFloat(primaryStyle.borderRadius);
    document.querySelector('[data-page="diagnostics"]').click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    document.querySelector('#diagSummary').innerHTML = '<div class="diagnostic-status is-warn"><b>需要关注</b><span>2 项检查 / 1 项异常</span></div><div class="diagnostic-metrics"><span><b>0</b>错误</span><span><b>1</b>警告</span><span><b>1</b>通过</span></div><div class="diagnostic-actions"><small>重启网络核心后重新检查。</small></div>';
    document.querySelector('#diagRows').innerHTML = '<section class="diagnostic-group"><header class="diagnostic-group-head"><div><h3>节点</h3><span>1 项需要处理</span></div><b>2 项</b></header><div class="diagnostic-group-rows"><article class="diagnostic-row severity-warning"><div class="diagnostic-row-copy"><div class="diagnostic-row-title"><b>近期网络异常</b><span class="diagnostic-code">AEG-NOD-099</span></div><p>近期日志中出现了需要关注的节点错误。</p><div class="diagnostic-hint"><b>建议</b><span>重启网络核心后重新检查。</span></div><details class="diagnostic-technical"><summary>查看技术细节</summary><code>[warn] mock warning</code></details></div><div class="diagnostic-row-actions"><span class="diagnostic-result warn">需要关注</span><button class="primary compact diagnostic-repair-btn">重启网络核心</button></div></article><article class="diagnostic-row severity-ok"><div class="diagnostic-row-copy"><div class="diagnostic-row-title"><b>网络核心</b><span class="diagnostic-code">AEG-CON-001</span></div><p>网络核心文件可用。</p></div><div class="diagnostic-row-actions"><span class="diagnostic-result ok">正常</span></div></article></div></section>';
    const diagnosticsBase = collectBase();
    const diagnosticsPanel = document.querySelector('[data-page-panel="diagnostics"]');
    const diagnosticsActive = diagnosticsPanel?.classList.contains('active') || false;
    const diagnosticsSummary = box('#diagSummary');
    const diagnosticCategoryFilters = box('.diagnostic-category-filters');
    const diagnosticsRows = box('#diagRows');
    const diagnosticTabs = box('.diagnostic-view-tabs');
    const diagnosticRepair = box('.diagnostic-repair-btn');
    const diagnosticView = box('#diagnosticOverviewView');
    const diagnosticsCard = box('[data-page-panel="diagnostics"] .diagnostic-card');
    const unlabeledIconButtons = all('button').filter((button) => {
      const hasVisibleText = button.textContent.trim().length > 0;
      const hasIcon = Boolean(button.querySelector('.aegos-icon'));
      return hasIcon && !hasVisibleText && !button.getAttribute('aria-label');
    }).map((button) => button.id || button.className || 'unnamed');
    const missingIconMasks = all('.aegos-icon').filter((icon) => visible(icon)).filter((icon) => {
      const style = getComputedStyle(icon, '::before');
      const mask = style.maskImage || style.webkitMaskImage || '';
      return !mask || mask === 'none';
    }).map((icon) => icon.className || 'unnamed');
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      deviceScaleFactor: window.devicePixelRatio,
      overflowX: Math.max(homeBase.overflowX, nodeBase.overflowX, routingBase.overflowX, profileBase.overflowX, settingsBase.overflowX, diagnosticsBase.overflowX),
      textOverflow: [...homeBase.textOverflow, ...nodeBase.textOverflow, ...routingBase.textOverflow, ...profileBase.textOverflow, ...settingsBase.textOverflow, ...diagnosticsBase.textOverflow],
      quickEscapes,
      visibleRows,
      connectionActionIssues,
      tableOverflowX: tableEl ? tableEl.scrollWidth - tableEl.clientWidth : 0,
      nodeToolbarPrimary,
      nodeFilterTabs,
      nodeToolbarSplit,
      routingDraftCardHidden,
      routingSummaryDetailHidden,
      routingSummaryHidden,
      routingKindCount: routingKindButtons.length,
      routingKindsVertical,
      routingActivePanels,
      routingAssistantHeadMissing,
      routingToolbarMissing,
      profileTableHead,
      profileTableRow,
      profileTableOverflowX,
      profileRowCount: profileRowBoxes.length,
      profileRowLayoutIssues,
      profileInvalidCopy,
      profileWrappedActions,
      maxMetricIcon: Math.max(...metricIcons),
      brandFontSize: parseFloat(getComputedStyle(document.querySelector('.brand-name')).fontSize),
      brandLogoLoaded: Boolean(document.querySelector('.brand-logo')?.complete && document.querySelector('.brand-logo')?.naturalWidth >= 48),
      shell: box('.shell'),
      nav: box('.nav'),
      navButtonHeight: box('.nav button')?.height || 0,
      ringWidth: homeRingWidth,
      tunHomeVisible,
      tunHomeCenterOffset,
      homeTunTextRemoved,
      regionOverflowContained,
      regionOverflowActive,
      quickIconTextGrouped,
      quickActionsRespectLimit,
      quickActionWidths,
      quickTunRowOffset,
      quickHeadingRemoved,
      topDragOverlapsStatus,
      nodeStatusFontSize,
      outboundIpFits,
      windowActionsBox,
      modeButtonBox,
      addFixedButtonBox,
      addFixedActionHiddenOutsidePage,
      fixedNodeHeaderBox,
      homeNameColumnBox,
      homeStatusColumnBox,
      homeStatusValueBox,
      homeStatusRightOffset,
      homeRows,
      activeHomeRegion,
      homeNodeLayout,
      statusCenterPanel: statusCenterPanelBox,
      statusCenterRowsWrapped,
      statusCenterOpen,
      statusCenterClosed,
      statusCenterFocusEntered,
      statusCenterFocusRestored,
      hero: homeHeroBox,
      quick: homeQuickBox,
      nodeStatusCard: nodeStatusCardBox,
      nodeStatusRows,
      sidebar: sidebarBox,
      heroCenterOffset,
      nodes: homeNodesBox,
      settings: settingsBox,
      settingsActive,
      settingsSummaryHidden,
      settingsCategoryCount,
      settingsVisiblePanels,
      settingsWorkspaceAligned,
      primaryUsesGradient,
      primaryRadius,
      tunToggleVisible,
      diagnosticsActive,
      diagnosticsSummary,
      diagnosticCategoryFilters,
      diagnosticsRows,
      diagnosticTabs,
      diagnosticRepair,
      diagnosticView,
      diagnosticsCard,
      unlabeledIconButtons,
      missingIconMasks,
      badPanels: [...homeBase.badPanels, ...nodeBase.badPanels, ...routingBase.badPanels, ...profileBase.badPanels, ...settingsBase.badPanels, ...diagnosticsBase.badPanels]
    };
  })()`);

  const scaleSuffix = deviceScaleFactor === 1 ? '' : `-dpr${String(deviceScaleFactor).replace('.', '_')}`;
  const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
  const pngPath = path.join(screenshotDir, `diagnostics-${width}x${height}${scaleSuffix}.png`);
  fs.writeFileSync(pngPath, Buffer.from(screenshot.data, 'base64'));
  report.screenshot = pngPath;
  report.pageScreenshots = [];
  report.statusCenterScreenshot = '';
  if (width === 1280 && height === 820 && deviceScaleFactor === 1) {
    for (const pageName of ['home', 'nodes', 'connections', 'routing', 'profiles', 'diagnostics', 'settings']) {
      await evaluate(page, `document.querySelector('[data-page="${pageName}"]').click()`);
      await delay(160);
      const pageShot = await page.send('Page.captureScreenshot', { format: 'png' });
      const pagePath = path.join(screenshotDir, `stage7-${pageName}-1280x820.png`);
      fs.writeFileSync(pagePath, Buffer.from(pageShot.data, 'base64'));
      report.pageScreenshots.push(pagePath);
    }
    await evaluate(page, `
      document.querySelector('[data-page="routing"]').click();
      document.querySelector('[data-routing-kind="system"]').click();
    `);
    await delay(120);
    for (const [state, setup] of [
      ['routing-system', ''],
      ['routing-test', `document.querySelector('[data-routing-kind="test"]').click();`],
      ['routing-advanced', `
        document.querySelector('[data-routing-kind="website"]').click();
        const detail = document.querySelector('#routingAdvancedPanel');
        detail.open = true;
        detail.dispatchEvent(new Event('toggle'));
      `]
    ]) {
      if (setup) await evaluate(page, setup);
      await delay(120);
      const stateShot = await page.send('Page.captureScreenshot', { format: 'png' });
      const statePath = path.join(screenshotDir, `stage7-${state}-1280x820.png`);
      fs.writeFileSync(statePath, Buffer.from(stateShot.data, 'base64'));
      report.pageScreenshots.push(statePath);
    }
    await evaluate(page, `
      document.querySelector('[data-page="settings"]').click();
      document.querySelector('[data-settings-category="extensions"]').click();
    `);
    await delay(120);
    const extensionShot = await page.send('Page.captureScreenshot', { format: 'png' });
    const extensionPath = path.join(screenshotDir, 'stage7-settings-extensions-1280x820.png');
    fs.writeFileSync(extensionPath, Buffer.from(extensionShot.data, 'base64'));
    report.pageScreenshots.push(extensionPath);
    await evaluate(page, `document.querySelector('#titlebarStatusCenterBtn').click()`);
    await delay(180);
    const statusCenterShot = await page.send('Page.captureScreenshot', { format: 'png' });
    const statusCenterPath = path.join(screenshotDir, 'stage7-status-center-1280x820.png');
    fs.writeFileSync(statusCenterPath, Buffer.from(statusCenterShot.data, 'base64'));
    report.statusCenterScreenshot = statusCenterPath;
    await evaluate(page, `document.querySelector('#closeStatusCenterBtn').click()`);
  }
  if (width === 920 && height === 640 && deviceScaleFactor === 1) {
    for (const pageName of ['home', 'nodes', 'connections', 'routing', 'profiles', 'diagnostics', 'settings']) {
      await evaluate(page, `document.querySelector('[data-page="${pageName}"]').click()`);
      await delay(160);
      const pageShot = await page.send('Page.captureScreenshot', { format: 'png' });
      const pagePath = path.join(screenshotDir, `stage7-${pageName}-920x640.png`);
      fs.writeFileSync(pagePath, Buffer.from(pageShot.data, 'base64'));
      report.pageScreenshots.push(pagePath);
    }
    for (const [state, setup] of [
      ['routing-test', `
        document.querySelector('[data-page="routing"]').click();
        document.querySelector('[data-routing-kind="test"]').click();
      `],
      ['settings-extensions', `
        document.querySelector('[data-page="settings"]').click();
        document.querySelector('[data-settings-category="extensions"]').click();
      `]
    ]) {
      await evaluate(page, setup);
      await delay(120);
      const stateShot = await page.send('Page.captureScreenshot', { format: 'png' });
      const statePath = path.join(screenshotDir, `stage7-${state}-920x640.png`);
      fs.writeFileSync(statePath, Buffer.from(stateShot.data, 'base64'));
      report.pageScreenshots.push(statePath);
    }
  }
  return report;
}

const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--disable-extensions',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  'about:blank'
], { stdio: 'ignore' });

let page;
try {
  await waitForChrome();
  page = await openPage();
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    (() => {
      const items = Array.from({ length: 18 }, (_, index) => ({
        name: 'HK ' + String(index + 1).padStart(2, '0'),
        realProxyName: 'HK ' + String(index + 1).padStart(2, '0'),
        type: index % 3 === 0 ? 'tuic' : 'ss',
        server: 'node-' + (index + 1) + '.example.com',
        country: 'HK',
        delay: 28 + index * 5,
        alive: true,
        favorite: index < 2,
        fixed: false,
        selected: index === 0,
        lastTestedAt: Math.floor(Date.now() / 1000)
      }));
      const profile = { id: 'ui-smoke', name: 'UI Smoke', type: 'remote', profile_type: 'remote', source_url: 'https://example.com/main.yaml', hasSourceUrl: true, updated_at: 1784555106000, nodeCount: items.length, proxyGroupCount: 1, ruleCount: 4276, subscriptionUsage: { upload: 1024, download: 2048, total: 1048576, expire: 1800000000 } };
      const profiles = [
        { id: 'direct', name: 'Direct', profile_type: 'builtin', updated_at: 0, nodeCount: 0, proxyGroupCount: 0, ruleCount: 0 },
        { id: 'local-tuic', name: '肯德基 tuic', profile_type: 'file', updated_at: 1784555090000, nodeCount: 23, proxyGroupCount: 0, ruleCount: 0 },
        { id: 'local-anytls', name: '肯德基 anytls', profile_type: 'file', updated_at: 1784555106000, nodeCount: 42, proxyGroupCount: 0, ruleCount: 0 },
        { id: 'local-vless', name: '肯德基 vless', profile_type: 'file', updated_at: 1784555122000, nodeCount: 17, proxyGroupCount: 0, ruleCount: 0 },
        profile
      ];
      const status = () => ({
        product: 'Aegos', appVersion: '${pkg.version}', running: false, coreReady: false,
        trafficTakeover: false, standby: false, mode: 'rule', traffic: { up: 0, down: 0 }, logs: [],
        activeProfile: profile,
        network: { lanIp: '192.168.1.8', proxyEndpoint: '127.0.0.1:7891', outboundIp: '188.253.127.200', availability: { state: 'unverified', label: '未验证', detail: '尚未连接' } },
        permissions: { isAdmin: true, requiresAdminFor: ['TUN', '断网保护'] },
        protection: { label: '未开启' },
        settings: { activeProfileId: profile.id, profiles, mixedPort: 7891, controllerPort: 19091, systemProxy: false, tunEnabled: false, startWithSystemProxy: true, dnsHijackEnabled: true, killSwitchEnabled: false, ipv6Enabled: false, allowLan: false, tunStack: 'mixed', logLevel: 'info', configExtensions: { additionalRulesEnabled: false, additionalRules: [], overrideScriptEnabled: false, overrideScript: '', format: 'yaml' }, reliability: { auto: true, profileFailover: true, failureThreshold: 2, maxDelayMs: 800, candidateLimit: 24 } }
      });
      const invoke = async (command, args = {}) => {
        if (command === 'app_status') return status();
        if (command === 'proxy_groups' || command === 'preview_profile_groups') return [{ name: 'Proxies', type: 'select', now: items[0].name, items }];
        if (command === 'routing_snapshot') return { mode: 'rule', groups: [{ name: 'Proxies', type: 'select', now: items[0].name, itemCount: items.length, automatic: false }], rules: [{ index: 1, kind: 'DOMAIN-SUFFIX', condition: 'example.com', target: 'Proxies', source: 'config', status: 'readonly', options: [] }], unboundUserRules: [], configRulePage: { profileId: profile.id, offset: 0, limit: 80, total: 1, hasMore: false }, summary: { groupCount: 1, userRuleCount: 0, systemRuleCount: 0, configRuleCount: 1, ruleCount: 1 } };
        if (command === 'routing_rule_page') return { profileId: profile.id, offset: 0, limit: 80, total: 1, hasMore: false, items: [] };
        if (command === 'active_connection_count') return { count: 0 };
        if (command === 'environment_readiness') return { summary: { label: '环境可用', level: 'ok' }, checks: [] };
        if (command === 'ipv6_dns_safety_snapshot') return { mode: 'auto', status: 'ipv4-fallback' };
        return true;
      };
      window.__TAURI__ = {
        core: { invoke },
        event: { listen: async () => () => {} }
      };
    })();
  ` });
  const reports = [
    await auditViewport(page, 1280, 820, 1),
    await auditViewport(page, 920, 640, 1),
    await auditViewport(page, 980, 640, 1),
    await auditViewport(page, 1280, 700, 1),
    await auditViewport(page, 1180, 700, 1),
    await auditViewport(page, 1180, 720, 1),
    await auditViewport(page, 1440, 900, 1),
    await auditViewport(page, 1536, 960, 1),
    await auditViewport(page, 1700, 900, 1),
    await auditViewport(page, 1280, 1080, 1),
    await auditViewport(page, 1280, 820, 1.25),
    await auditViewport(page, 1280, 820, 1.5),
    await auditViewport(page, 1280, 820, 1.75),
    await auditViewport(page, 1280, 820, 2)
  ];
  const failures = [];
  for (const report of reports) {
    if (report.overflowX > 1) failures.push(`${report.width}x${report.height}: horizontal overflow ${report.overflowX}px`);
    if (report.tableOverflowX > 1) failures.push(`${report.width}x${report.height}: node table horizontal overflow ${report.tableOverflowX}px`);
    if (report.visibleRows < 5) failures.push(`${report.width}x${report.height}: only ${report.visibleRows} node rows visible`);
    if (!report.nodeToolbarSplit) failures.push(`${report.width}x${report.height}: node toolbar is not split into stable command and filter rows`);
    if (!report.routingDraftCardHidden) failures.push(`${report.width}x${report.height}: empty routing draft area is visible`);
    if (!report.routingSummaryDetailHidden) failures.push(`${report.width}x${report.height}: routing summary detail expanded without a user request`);
    if (!report.routingSummaryHidden) failures.push(`${report.width}x${report.height}: low-value routing dashboard remained visible`);
    if (report.routingKindCount !== 4 || !report.routingKindsVertical || report.routingActivePanels !== 1) failures.push(`${report.width}x${report.height}: routing types are not a clear single-panel workflow`);
    if (report.connectionActionIssues.length) failures.push(`${report.width}x${report.height}: connection actions are clipped: ${report.connectionActionIssues.join(', ')}`);
    if (!report.routingAssistantHeadMissing || !report.routingToolbarMissing) failures.push(`${report.width}x${report.height}: routing assistant retained duplicate heading or controls`);
    if (!report.profileTableHead || !report.profileTableRow) failures.push(`${report.width}x${report.height}: subscription comparison table is incomplete`);
    if (report.profileTableOverflowX > 1) failures.push(`${report.width}x${report.height}: subscription table horizontal overflow ${report.profileTableOverflowX}px`);
    if (report.profileRowCount !== 5) failures.push(`${report.width}x${report.height}: subscription stress fixture rendered ${report.profileRowCount} rows`);
    if (report.profileRowLayoutIssues.length) failures.push(`${report.width}x${report.height}: subscription rows overlap or escape: ${report.profileRowLayoutIssues.join(', ')}`);
    if (report.profileInvalidCopy.length) failures.push(`${report.width}x${report.height}: subscription page retained low-value/raw copy: ${report.profileInvalidCopy.join(', ')}`);
    if (report.profileWrappedActions.length) failures.push(`${report.width}x${report.height}: subscription actions wrapped: ${report.profileWrappedActions.join(', ')}`);
    if (!report.settingsActive) failures.push(`${report.width}x${report.height}: settings page did not activate`);
    if (!report.settingsSummaryHidden) failures.push(`${report.width}x${report.height}: low-value settings dashboard remained visible`);
    if (report.settingsCategoryCount !== 7 || report.settingsVisiblePanels !== 1 || !report.settingsWorkspaceAligned) failures.push(`${report.width}x${report.height}: settings category hierarchy is incomplete or misaligned`);
    if (report.primaryUsesGradient) failures.push(`${report.width}x${report.height}: primary command uses a decorative gradient`);
    if (report.primaryRadius > 6.1) failures.push(`${report.width}x${report.height}: primary command radius is ${report.primaryRadius}px`);
    if (!report.diagnosticsActive) failures.push(`${report.width}x${report.height}: diagnostics page did not activate`);
    if (!report.tunToggleVisible) failures.push(`${report.width}x${report.height}: TUN toggle is not visible`);
    if (!report.tunHomeVisible) failures.push(`${report.width}x${report.height}: home TUN toggle is not visible`);
    if (!report.homeTunTextRemoved) failures.push(`${report.width}x${report.height}: removed home TUN state text still renders`);
    if (report.tunHomeCenterOffset == null || report.tunHomeCenterOffset > 1.5) failures.push(`${report.width}x${report.height}: home TUN toggle is vertically offset by ${report.tunHomeCenterOffset}px`);
    if (!report.regionOverflowContained) failures.push(`${report.width}x${report.height}: extended home regions are not contained by horizontal scrolling`);
    if (report.width <= 980 && !report.regionOverflowActive) failures.push(`${report.width}x${report.height}: extended home regions did not activate horizontal scrolling`);
    if (!report.quickIconTextGrouped) failures.push(`${report.width}x${report.height}: quick action icon and label are visually disconnected`);
    if (!report.quickActionsRespectLimit) failures.push(`${report.width}x${report.height}: home renders more than four resident quick actions`);
    if (report.quickActionWidths.some((width) => width < 105 || width > 121)) failures.push(`${report.width}x${report.height}: quick action widths are outside the compact 106-120px range`);
    if (report.quickTunRowOffset == null || report.quickTunRowOffset > 2) failures.push(`${report.width}x${report.height}: quick actions and TUN control differ by ${report.quickTunRowOffset}px vertically`);
    if (!report.quickHeadingRemoved) failures.push(`${report.width}x${report.height}: redundant quick-action heading still renders`);
    if (report.topDragOverlapsStatus) failures.push(`${report.width}x${report.height}: top drag region overlaps status center trigger`);
    if (report.nodeStatusFontSize < 12) failures.push(`${report.width}x${report.height}: node status text is only ${report.nodeStatusFontSize}px`);
    if (!report.outboundIpFits) failures.push(`${report.width}x${report.height}: full landing IP does not fit the sidebar`);
    if (!report.sidebar || report.sidebar.width < 194 || report.sidebar.width > 198) failures.push(`${report.width}x${report.height}: sidebar width is not restrained around 196px`);
    if (!report.windowActionsBox || report.windowActionsBox.top < 4 || report.width - report.windowActionsBox.right < 12) failures.push(`${report.width}x${report.height}: window controls lack safe edge clearance`);
    if (!report.modeButtonBox || report.width - report.modeButtonBox.right < 12) failures.push(`${report.width}x${report.height}: mode control lacks right-edge clearance`);
    if (!report.addFixedActionHiddenOutsidePage) failures.push(`${report.width}x${report.height}: fixed-node action leaks outside the fixed-node page`);
    if (!report.addFixedButtonBox || report.width - report.addFixedButtonBox.right < 12) failures.push(`${report.width}x${report.height}: fixed-node action lacks right-edge clearance`);
    if (!report.fixedNodeHeaderBox || report.addFixedButtonBox.top < report.fixedNodeHeaderBox.top - 1 || report.addFixedButtonBox.bottom > report.fixedNodeHeaderBox.bottom + 1) failures.push(`${report.width}x${report.height}: fixed-node action is not aligned inside its page header`);
    if (!report.homeNameColumnBox || report.homeNameColumnBox.width > 370) failures.push(`${report.width}x${report.height}: home node-name column leaves excessive empty space (${report.homeNameColumnBox?.width || 0}px)`);
    if (!report.homeStatusColumnBox || report.width - report.homeStatusColumnBox.right > 50) failures.push(`${report.width}x${report.height}: home status column leaves excessive right-side space`);
    if (report.homeStatusRightOffset == null || report.homeStatusRightOffset > 1.5) failures.push(`${report.width}x${report.height}: home status heading and values differ by ${report.homeStatusRightOffset ?? 'unknown'}px`);
    const minHomeRows = report.activeHomeRegion ? 1 : 5;
    if (report.homeRows < minHomeRows) failures.push(`${report.width}x${report.height}: only ${report.homeRows} home node rows visible`);
    if (!report.homeNodeLayout) failures.push(`${report.width}x${report.height}: home node layout metrics missing`);
    if (report.homeNodeLayout?.regionToHeadGap < -1) failures.push(`${report.width}x${report.height}: home region row overlaps table head by ${Math.abs(report.homeNodeLayout.regionToHeadGap)}px`);
    if (report.homeNodeLayout?.headToFirstRowGap < -1) failures.push(`${report.width}x${report.height}: home table head overlaps first row by ${Math.abs(report.homeNodeLayout.headToFirstRowGap)}px`);
    if (report.homeNodeLayout?.headToFirstRowGap > 16) failures.push(`${report.width}x${report.height}: home table head is separated from first row by ${report.homeNodeLayout.headToFirstRowGap}px`);
    if (report.homeNodeLayout?.headHeight > 42) failures.push(`${report.width}x${report.height}: home table head stretched to ${report.homeNodeLayout.headHeight}px`);
    if (report.maxMetricIcon > 24) failures.push(`${report.width}x${report.height}: metric icon width ${report.maxMetricIcon}px`);
    if (!report.brandLogoLoaded) failures.push(`${report.width}x${report.height}: Aegos brand logo did not load`);
    if (!report.hero || report.hero.height > 194) failures.push(`${report.width}x${report.height}: home hero row too tall ${report.hero?.height || 0}px`);
    if (!report.quick || report.quick.height < 42 || report.quick.height > 45) failures.push(`${report.width}x${report.height}: embedded quick row height changed to ${report.quick?.height || 0}px`);
    if (!report.nodeStatusCard || report.nodeStatusRows !== 9) failures.push(`${report.width}x${report.height}: compact node status card is missing rows`);
    if (report.height >= 640 && report.nodeStatusCard?.height < 230) failures.push(`${report.width}x${report.height}: node status section is too short (${report.nodeStatusCard?.height || 0}px)`);
    if (report.nodeStatusCard && report.sidebar && (report.nodeStatusCard.bottom > report.sidebar.bottom + 1 || report.sidebar.bottom - report.nodeStatusCard.bottom > 18)) failures.push(`${report.width}x${report.height}: node status card is not anchored at the sidebar bottom`);
    if (report.heroCenterOffset > 8) failures.push(`${report.width}x${report.height}: home hero columns use mismatched vertical alignment (${report.heroCenterOffset.toFixed(1)}px)`);
    if (!report.statusCenterOpen || !report.statusCenterClosed) failures.push(`${report.width}x${report.height}: status center did not open and close`);
    if (!report.statusCenterFocusEntered || !report.statusCenterFocusRestored) failures.push(`${report.width}x${report.height}: status center focus lifecycle failed`);
    if (!report.statusCenterPanel || report.statusCenterPanel.right > report.width + 1 || report.statusCenterPanel.bottom > report.height + 1 || report.statusCenterPanel.width < 299 || report.statusCenterPanel.width > 321) failures.push(`${report.width}x${report.height}: status center panel is clipped or outside the compact width`);
    if (report.statusCenterRowsWrapped.length) failures.push(`${report.width}x${report.height}: status center rows wrap: ${report.statusCenterRowsWrapped.join(', ')}`);
    if (report.quickEscapes.length) failures.push(`${report.width}x${report.height}: quick buttons escape container: ${report.quickEscapes.join(', ')}`);
    if (report.badPanels.length) failures.push(`${report.width}x${report.height}: panels outside viewport: ${report.badPanels.join(', ')}`);
    if (report.unlabeledIconButtons.length) failures.push(`${report.width}x${report.height}: unlabeled icon buttons: ${report.unlabeledIconButtons.join(', ')}`);
    if (report.missingIconMasks.length) failures.push(`${report.width}x${report.height}: visible icons without masks: ${report.missingIconMasks.join(', ')}`);
    if (!report.diagnosticsSummary || report.diagnosticsSummary.height < 48) failures.push(`${report.width}x${report.height}: diagnostic summary did not render with stable height`);
    if (!report.diagnosticsRows || report.diagnosticsRows.height < 120) failures.push(`${report.width}x${report.height}: diagnostic issue list did not receive usable space`);
    if (!report.diagnosticTabs || report.diagnosticTabs.height < 30) failures.push(`${report.width}x${report.height}: diagnostic internal tabs are missing`);
    if (!report.diagnosticRepair || report.diagnosticRepair.width < 80) failures.push(`${report.width}x${report.height}: diagnostic repair action is clipped`);
    if (!report.diagnosticsSummary || !report.diagnosticCategoryFilters || !report.diagnosticsRows || report.diagnosticCategoryFilters.top < report.diagnosticsSummary.bottom - 1 || report.diagnosticsRows.top < report.diagnosticCategoryFilters.bottom - 1) failures.push(`${report.width}x${report.height}: diagnostic content is not vertically ordered`);
    if (!report.diagnosticView || report.diagnosticView.bottom - report.diagnosticsRows.bottom > 20) failures.push(`${report.width}x${report.height}: diagnostic issue list leaves unused vertical space`);
    if (!report.diagnosticsCard || report.height - report.diagnosticsCard.bottom > 32) failures.push(`${report.width}x${report.height}: diagnostic repair center does not fill the page height`);
    const seriousTextOverflow = report.textOverflow.filter((text) => text && !text.includes('127.0.0.1'));
    if (seriousTextOverflow.length) failures.push(`${report.width}x${report.height}: text overflow: ${seriousTextOverflow.join(', ')}`);
  }
  const base = reports[0];
  for (const report of reports.slice(1)) {
    if (![1, 1.25, 1.5, 1.75, 2].includes(report.deviceScaleFactor)) failures.push(`${report.width}x${report.height}: unexpected device scale ${report.deviceScaleFactor}`);
    if (Math.abs(report.brandFontSize - base.brandFontSize) > 0.1) failures.push(`${report.width}x${report.height}: brand font scaled from ${base.brandFontSize}px to ${report.brandFontSize}px`);
    if (Math.abs(report.maxMetricIcon - base.maxMetricIcon) > 0.1) failures.push(`${report.width}x${report.height}: metric icons scaled from ${base.maxMetricIcon}px to ${report.maxMetricIcon}px`);
    if (Math.abs(report.navButtonHeight - base.navButtonHeight) > 4) failures.push(`${report.width}x${report.height}: nav height changed from ${base.navButtonHeight}px to ${report.navButtonHeight}px`);
    if (Math.abs(report.ringWidth - base.ringWidth) > 0.1) failures.push(`${report.width}x${report.height}: ring scaled from ${base.ringWidth}px to ${report.ringWidth}px`);
  }
  const base1280 = reports.find((report) => report.width === 1280 && report.height === 820);
  for (const report of reports.filter((item) => item.width === 1280 && item !== base1280)) {
    if (Math.abs((report.shell?.left || 0) - (base1280.shell?.left || 0)) > 0.1) failures.push(`${report.width}x${report.height}: shell left shifted with height`);
    if (Math.abs((report.nav?.top || 0) - (base1280.nav?.top || 0)) > 0.1) failures.push(`${report.width}x${report.height}: nav top shifted with height`);
    if (Math.abs(report.hero.height - base1280.hero.height) > 0.1) failures.push(`${report.width}x${report.height}: home hero height shifted with height`);
    if (Math.abs(report.quick.height - base1280.quick.height) > 0.1) failures.push(`${report.width}x${report.height}: quick height shifted with height`);
  }
  console.log(JSON.stringify({ ok: failures.length === 0, failures, reports }, null, 2));
  if (failures.length) process.exitCode = 2;
} finally {
  try { await page?.close(); } catch {}
  try { chrome.kill(); } catch {}
  if (chrome.pid && process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  }
  if (!(await removeTestUserDataDir(userDataDir))) {
    console.error(`UI smoke temporary root was not removed: ${userDataDir}`);
    process.exitCode = 2;
  }
}
