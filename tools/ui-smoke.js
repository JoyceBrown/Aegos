import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

async function auditViewport(page, width, height, deviceScaleFactor = 1) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor,
    mobile: false
  });
  await page.send('Page.navigate', { url: appUrl });
  await delay(900);

  const report = await evaluate(page, `(() => {
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
    const sidebarSummaryOverflow = all('.sidebar-runtime-summary :is(strong, p, span, button)').filter((el) => {
      return visible(el) && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    }).map((el) => el.id || el.textContent.trim());
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
    const topDragBox = box('.edge-drag-top');
    const titlebarStatusBox = box('#titlebarStatusCenterBtn');
    const topDragOverlapsStatus = topDragBox && titlebarStatusBox ? topDragBox.right > titlebarStatusBox.left + 1 : false;
    const navBox = box('.nav');
    const sidebarSummaryBox = box('.sidebar-runtime-summary');
    const sidebarOverlap = navBox && sidebarSummaryBox ? navBox.bottom > sidebarSummaryBox.top + 1 : false;
    const bottomMetricWidths = all('.metric-grid.bottom article').map((el) => Math.round(el.getBoundingClientRect().width));
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
    const statusTrigger = document.querySelector('#sidebarStatusCenterBtn');
    statusTrigger.focus();
    statusTrigger.click();
    const statusCenterPanelBox = box('#statusCenterPanel');
    const statusCenterRowsWrapped = all('#statusCenterPanel .status-card dl div').filter((el) => visible(el) && el.getBoundingClientRect().height > 34).map((el) => el.textContent.trim());
    const statusCenterOpen = !document.querySelector('#statusCenterOverlay')?.classList.contains('hidden');
    const statusCenterFocusEntered = document.activeElement?.id === 'closeStatusCenterBtn';
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const statusCenterClosed = document.querySelector('#statusCenterOverlay')?.classList.contains('hidden') || false;
    const statusCenterFocusRestored = document.activeElement?.id === 'sidebarStatusCenterBtn';
    document.querySelector('[data-page="nodes"]').click();
    const nodeBase = collectBase();
    const table = document.querySelector('.node-table')?.getBoundingClientRect();
    const tableEl = document.querySelector('.node-table');
    const visibleRows = table ? all('#nodeRows .row').filter((row) => {
      const r = row.getBoundingClientRect();
      return r.bottom > table.top && r.top < table.bottom;
    }).length : 0;
    document.querySelector('[data-page="settings"]').click();
    const settingsBase = collectBase();
    const settingsPanel = document.querySelector('[data-page-panel="settings"]');
    const tunToggle = document.querySelector('#tunToggle');
    const settingsActive = settingsPanel?.classList.contains('active') || false;
    const tunToggleVisible = Boolean(tunToggle && visible(tunToggle));
    const settingsBox = box('[data-page-panel="settings"] .page-card');
    const settingsSummary = box('[data-page-panel="settings"] .settings-summary-grid');
    const settingsSections = all('[data-page-panel="settings"] .settings-section').filter(visible).length;
    document.querySelector('[data-page="diagnostics"]').click();
    document.querySelector('#diagSummary').innerHTML = '<div class="diagnostic-status is-warn"><b>需要关注</b><span>2 项检查 / 1 项异常</span></div><div class="diagnostic-metrics"><span><b>0</b>错误</span><span><b>1</b>警告</span><span><b>1</b>通过</span></div><div class="diagnostic-actions"><small>重启网络核心后重新检查。</small></div>';
    document.querySelector('#diagRows').innerHTML = '<section class="diagnostic-group"><header class="diagnostic-group-head"><div><h3>节点</h3><span>1 项需要处理</span></div><b>2 项</b></header><div class="diagnostic-group-rows"><article class="diagnostic-row severity-warning"><div class="diagnostic-row-copy"><div class="diagnostic-row-title"><b>近期网络异常</b><span class="diagnostic-code">AEG-NOD-099</span></div><p>近期日志中出现了需要关注的节点错误。</p><div class="diagnostic-hint"><b>建议</b><span>重启网络核心后重新检查。</span></div><details class="diagnostic-technical"><summary>查看技术细节</summary><code>[warn] mock warning</code></details></div><div class="diagnostic-row-actions"><span class="diagnostic-result warn">需要关注</span><button class="primary compact diagnostic-repair-btn">重启网络核心</button></div></article><article class="diagnostic-row severity-ok"><div class="diagnostic-row-copy"><div class="diagnostic-row-title"><b>网络核心</b><span class="diagnostic-code">AEG-CON-001</span></div><p>网络核心文件可用。</p></div><div class="diagnostic-row-actions"><span class="diagnostic-result ok">正常</span></div></article></div></section>';
    const diagnosticsBase = collectBase();
    const diagnosticsPanel = document.querySelector('[data-page-panel="diagnostics"]');
    const diagnosticsActive = diagnosticsPanel?.classList.contains('active') || false;
    const diagnosticsSummary = box('#diagSummary');
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
      overflowX: Math.max(homeBase.overflowX, nodeBase.overflowX, settingsBase.overflowX, diagnosticsBase.overflowX),
      textOverflow: [...homeBase.textOverflow, ...nodeBase.textOverflow, ...settingsBase.textOverflow, ...diagnosticsBase.textOverflow],
      quickEscapes,
      visibleRows,
      tableOverflowX: tableEl ? tableEl.scrollWidth - tableEl.clientWidth : 0,
      maxMetricIcon: Math.max(...metricIcons),
      brandFontSize: parseFloat(getComputedStyle(document.querySelector('.brand-name')).fontSize),
      brandLogoLoaded: Boolean(document.querySelector('.brand-logo')?.complete && document.querySelector('.brand-logo')?.naturalWidth >= 48),
      shell: box('.shell'),
      nav: box('.nav'),
      navButtonHeight: box('.nav button')?.height || 0,
      ringWidth: homeRingWidth,
      tunHomeVisible,
      topDragOverlapsStatus,
      homeRows,
      activeHomeRegion,
      homeNodeLayout,
      sidebarSummaryOverflow,
      sidebarOverlap,
      sidebarSummary: sidebarSummaryBox,
      statusCenterPanel: statusCenterPanelBox,
      statusCenterRowsWrapped,
      statusCenterOpen,
      statusCenterClosed,
      statusCenterFocusEntered,
      statusCenterFocusRestored,
      hero: homeHeroBox,
      quick: homeQuickBox,
      bottomMetricWidths,
      heroCenterOffset,
      nodes: homeNodesBox,
      settings: settingsBox,
      settingsActive,
      settingsSummary,
      settingsSections,
      tunToggleVisible,
      diagnosticsActive,
      diagnosticsSummary,
      diagnosticsRows,
      diagnosticTabs,
      diagnosticRepair,
      diagnosticView,
      diagnosticsCard,
      unlabeledIconButtons,
      missingIconMasks,
      badPanels: [...homeBase.badPanels, ...nodeBase.badPanels, ...settingsBase.badPanels, ...diagnosticsBase.badPanels]
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
    await evaluate(page, `document.querySelector('#titlebarStatusCenterBtn').click()`);
    await delay(180);
    const statusCenterShot = await page.send('Page.captureScreenshot', { format: 'png' });
    const statusCenterPath = path.join(screenshotDir, 'stage7-status-center-1280x820.png');
    fs.writeFileSync(statusCenterPath, Buffer.from(statusCenterShot.data, 'base64'));
    report.statusCenterScreenshot = statusCenterPath;
    await evaluate(page, `document.querySelector('#closeStatusCenterBtn').click()`);
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
  const reports = [
    await auditViewport(page, 1280, 820, 1),
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
    if (!report.settingsActive) failures.push(`${report.width}x${report.height}: settings page did not activate`);
    if (!report.settingsSummary || report.settingsSummary.height < 48) failures.push(`${report.width}x${report.height}: settings summary did not render with stable height`);
    if (report.settingsSections < 5) failures.push(`${report.width}x${report.height}: settings sections missing, found ${report.settingsSections}`);
    if (!report.diagnosticsActive) failures.push(`${report.width}x${report.height}: diagnostics page did not activate`);
    if (!report.tunToggleVisible) failures.push(`${report.width}x${report.height}: TUN toggle is not visible`);
    if (!report.tunHomeVisible) failures.push(`${report.width}x${report.height}: home TUN toggle is not visible`);
    if (report.topDragOverlapsStatus) failures.push(`${report.width}x${report.height}: top drag region overlaps status center trigger`);
    const minHomeRows = report.activeHomeRegion ? 1 : 5;
    if (report.homeRows < minHomeRows) failures.push(`${report.width}x${report.height}: only ${report.homeRows} home node rows visible`);
    if (!report.homeNodeLayout) failures.push(`${report.width}x${report.height}: home node layout metrics missing`);
    if (report.homeNodeLayout?.regionToHeadGap < -1) failures.push(`${report.width}x${report.height}: home region row overlaps table head by ${Math.abs(report.homeNodeLayout.regionToHeadGap)}px`);
    if (report.homeNodeLayout?.headToFirstRowGap < -1) failures.push(`${report.width}x${report.height}: home table head overlaps first row by ${Math.abs(report.homeNodeLayout.headToFirstRowGap)}px`);
    if (report.homeNodeLayout?.headToFirstRowGap > 16) failures.push(`${report.width}x${report.height}: home table head is separated from first row by ${report.homeNodeLayout.headToFirstRowGap}px`);
    if (report.homeNodeLayout?.headHeight > 42) failures.push(`${report.width}x${report.height}: home table head stretched to ${report.homeNodeLayout.headHeight}px`);
    if (report.maxMetricIcon > 24) failures.push(`${report.width}x${report.height}: metric icon width ${report.maxMetricIcon}px`);
    if (!report.brandLogoLoaded) failures.push(`${report.width}x${report.height}: Aegos brand logo did not load`);
    if (!report.hero || report.hero.height > 276) failures.push(`${report.width}x${report.height}: home hero row too tall ${report.hero?.height || 0}px`);
    if (!report.quick || Math.abs(report.quick.height - 72) > 1) failures.push(`${report.width}x${report.height}: quick row height changed to ${report.quick?.height || 0}px`);
    if (report.heroCenterOffset > 8) failures.push(`${report.width}x${report.height}: home hero columns use mismatched vertical alignment (${report.heroCenterOffset.toFixed(1)}px)`);
    if (report.bottomMetricWidths?.length === 6) {
      const outboundWidth = report.bottomMetricWidths[1];
      const upWidth = report.bottomMetricWidths[4];
      const downWidth = report.bottomMetricWidths[5];
      if (outboundWidth <= upWidth || outboundWidth <= downWidth) failures.push(`${report.width}x${report.height}: outbound IP metric is not wider than traffic metrics`);
      if (outboundWidth > upWidth * 2.5 || outboundWidth > downWidth * 2.5) failures.push(`${report.width}x${report.height}: outbound IP metric is wider than needed`);
    } else {
      failures.push(`${report.width}x${report.height}: bottom metric widths missing`);
    }
    if (report.sidebarOverlap) failures.push(`${report.width}x${report.height}: sidebar navigation overlaps compact runtime summary`);
    if (report.sidebarSummaryOverflow.length) failures.push(`${report.width}x${report.height}: sidebar runtime summary overflows: ${report.sidebarSummaryOverflow.join(', ')}`);
    if (!report.sidebarSummary || report.sidebarSummary.height < 120 || report.sidebarSummary.height > 180) failures.push(`${report.width}x${report.height}: compact runtime summary has unstable height ${report.sidebarSummary?.height || 0}px`);
    if (!report.statusCenterOpen || !report.statusCenterClosed) failures.push(`${report.width}x${report.height}: status center did not open and close`);
    if (!report.statusCenterFocusEntered || !report.statusCenterFocusRestored) failures.push(`${report.width}x${report.height}: status center focus lifecycle failed`);
    if (!report.statusCenterPanel || report.statusCenterPanel.right > report.width + 1 || report.statusCenterPanel.bottom > report.height + 1 || report.statusCenterPanel.width < 330) failures.push(`${report.width}x${report.height}: status center panel is clipped or undersized`);
    if (report.statusCenterRowsWrapped.length) failures.push(`${report.width}x${report.height}: status center rows wrap: ${report.statusCenterRowsWrapped.join(', ')}`);
    if (report.quickEscapes.length) failures.push(`${report.width}x${report.height}: quick buttons escape container: ${report.quickEscapes.join(', ')}`);
    if (report.badPanels.length) failures.push(`${report.width}x${report.height}: panels outside viewport: ${report.badPanels.join(', ')}`);
    if (report.unlabeledIconButtons.length) failures.push(`${report.width}x${report.height}: unlabeled icon buttons: ${report.unlabeledIconButtons.join(', ')}`);
    if (report.missingIconMasks.length) failures.push(`${report.width}x${report.height}: visible icons without masks: ${report.missingIconMasks.join(', ')}`);
    if (!report.diagnosticsSummary || report.diagnosticsSummary.height < 48) failures.push(`${report.width}x${report.height}: diagnostic summary did not render with stable height`);
    if (!report.diagnosticsRows || report.diagnosticsRows.height < 120) failures.push(`${report.width}x${report.height}: diagnostic issue list did not receive usable space`);
    if (!report.diagnosticTabs || report.diagnosticTabs.height < 30) failures.push(`${report.width}x${report.height}: diagnostic internal tabs are missing`);
    if (!report.diagnosticRepair || report.diagnosticRepair.width < 80) failures.push(`${report.width}x${report.height}: diagnostic repair action is clipped`);
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
  try { page?.close(); } catch {}
  chrome.kill();
  await delay(300);
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
  } catch {}
}
