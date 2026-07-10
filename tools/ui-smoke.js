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

async function auditViewport(page, width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
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
    const sidebarWrappedRows = all('.status-card dl div').filter((el) => {
      const dd = el.querySelector('dd');
      const dt = el.querySelector('dt');
      return visible(el) && ((dd && dd.scrollHeight > dd.clientHeight + 1) || (dt && dt.scrollHeight > dt.clientHeight + 1) || el.getBoundingClientRect().height > 27);
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
    const navBox = box('.nav');
    const statusBox = box('.status-card');
    const sidebarOverlap = navBox && statusBox ? navBox.bottom > statusBox.top + 1 : false;
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
    const settingsSummary = box('.settings-summary-grid');
    const settingsSections = all('[data-page-panel="settings"] .settings-section').filter(visible).length;
    document.querySelector('[data-page="diagnostics"]').click();
    document.querySelector('#diagSummary').innerHTML = '<div class="diagnostic-status is-warn"><b>需要关注</b><span>2 项检查 / 1 项异常</span></div><div class="diagnostic-metrics"><span><b>0</b>错误</span><span><b>1</b>警告</span><span><b>1</b>通过</span></div><div class="diagnostic-actions"><small>打开日志页查看最近核心 warning。</small></div>';
    document.querySelector('#diagRows').innerHTML = '<article class="list-card diagnostic-row severity-warning"><div><b>Recent core logs</b><small>[warn] mock warning</small><small class="diagnostic-hint">打开日志页查看最近核心 warning。</small></div><span class="warn">警告</span></article><article class="list-card diagnostic-row severity-ok"><div><b>mihomo core</b><small>mock</small></div><span class="ok">通过</span></article>';
    const diagnosticsBase = collectBase();
    const diagnosticsPanel = document.querySelector('[data-page-panel="diagnostics"]');
    const diagnosticsActive = diagnosticsPanel?.classList.contains('active') || false;
    const diagnosticsSummary = box('#diagSummary');
    document.querySelector('[data-page="home"]').click();
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      overflowX: Math.max(homeBase.overflowX, nodeBase.overflowX, settingsBase.overflowX, diagnosticsBase.overflowX),
      textOverflow: [...homeBase.textOverflow, ...nodeBase.textOverflow, ...settingsBase.textOverflow, ...diagnosticsBase.textOverflow],
      quickEscapes,
      visibleRows,
      tableOverflowX: tableEl ? tableEl.scrollWidth - tableEl.clientWidth : 0,
      maxMetricIcon: Math.max(...metricIcons),
      brandFontSize: parseFloat(getComputedStyle(document.querySelector('.brand-name')).fontSize),
      navButtonHeight: box('.nav button')?.height || 0,
      ringWidth: box('.ring')?.width || 0,
      tunHomeVisible,
      homeRows,
      activeHomeRegion,
      homeNodeLayout,
      sidebarWrappedRows,
      sidebarOverlap,
      hero: box('.hero'),
      quick: box('.quick'),
      nodes: box('.nodes'),
      settings: settingsBox,
      settingsActive,
      settingsSummary,
      settingsSections,
      tunToggleVisible,
      diagnosticsActive,
      diagnosticsSummary,
      badPanels: [...homeBase.badPanels, ...nodeBase.badPanels, ...settingsBase.badPanels, ...diagnosticsBase.badPanels]
    };
  })()`);

  const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
  const pngPath = path.join(screenshotDir, `home-${width}x${height}.png`);
  fs.writeFileSync(pngPath, Buffer.from(screenshot.data, 'base64'));
  report.screenshot = pngPath;
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
    await auditViewport(page, 1280, 820),
    await auditViewport(page, 1180, 700),
    await auditViewport(page, 1700, 900),
    await auditViewport(page, 1280, 1080)
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
    const minHomeRows = report.activeHomeRegion ? 1 : 5;
    if (report.homeRows < minHomeRows) failures.push(`${report.width}x${report.height}: only ${report.homeRows} home node rows visible`);
    if (!report.homeNodeLayout) failures.push(`${report.width}x${report.height}: home node layout metrics missing`);
    if (report.homeNodeLayout?.regionToHeadGap < -1) failures.push(`${report.width}x${report.height}: home region row overlaps table head by ${Math.abs(report.homeNodeLayout.regionToHeadGap)}px`);
    if (report.homeNodeLayout?.headToFirstRowGap < -1) failures.push(`${report.width}x${report.height}: home table head overlaps first row by ${Math.abs(report.homeNodeLayout.headToFirstRowGap)}px`);
    if (report.homeNodeLayout?.headToFirstRowGap > 16) failures.push(`${report.width}x${report.height}: home table head is separated from first row by ${report.homeNodeLayout.headToFirstRowGap}px`);
    if (report.homeNodeLayout?.headHeight > 42) failures.push(`${report.width}x${report.height}: home table head stretched to ${report.homeNodeLayout.headHeight}px`);
    if (report.maxMetricIcon > 24) failures.push(`${report.width}x${report.height}: metric icon width ${report.maxMetricIcon}px`);
    if (report.sidebarOverlap) failures.push(`${report.width}x${report.height}: sidebar navigation overlaps status card`);
    if (report.sidebarWrappedRows.length) failures.push(`${report.width}x${report.height}: sidebar status rows wrap: ${report.sidebarWrappedRows.join(', ')}`);
    if (report.quickEscapes.length) failures.push(`${report.width}x${report.height}: quick buttons escape container: ${report.quickEscapes.join(', ')}`);
    if (report.badPanels.length) failures.push(`${report.width}x${report.height}: panels outside viewport: ${report.badPanels.join(', ')}`);
    if (!report.diagnosticsSummary || report.diagnosticsSummary.height < 48) failures.push(`${report.width}x${report.height}: diagnostic summary did not render with stable height`);
    const seriousTextOverflow = report.textOverflow.filter((text) => text && !text.includes('127.0.0.1'));
    if (seriousTextOverflow.length) failures.push(`${report.width}x${report.height}: text overflow: ${seriousTextOverflow.join(', ')}`);
  }
  const base = reports[0];
  for (const report of reports.slice(1)) {
    if (Math.abs(report.brandFontSize - base.brandFontSize) > 0.1) failures.push(`${report.width}x${report.height}: brand font scaled from ${base.brandFontSize}px to ${report.brandFontSize}px`);
    if (Math.abs(report.maxMetricIcon - base.maxMetricIcon) > 0.1) failures.push(`${report.width}x${report.height}: metric icons scaled from ${base.maxMetricIcon}px to ${report.maxMetricIcon}px`);
    if (Math.abs(report.navButtonHeight - base.navButtonHeight) > 4) failures.push(`${report.width}x${report.height}: nav height changed from ${base.navButtonHeight}px to ${report.navButtonHeight}px`);
    if (report.width > 1380 && Math.abs(report.ringWidth - base.ringWidth) > 0.1) failures.push(`${report.width}x${report.height}: ring scaled from ${base.ringWidth}px to ${report.ringWidth}px`);
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
