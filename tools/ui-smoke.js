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
    const overflowX = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth;
    const textOverflow = all('button, .notice, h1, .metric-grid strong').filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent.trim());
    const quickEscapes = all('.quick-row button').filter((el) => {
      const r = el.getBoundingClientRect();
      const parent = el.closest('.quick').getBoundingClientRect();
      return r.left < parent.left - 1 || r.right > parent.right + 1 || r.height > 36;
    }).map((el) => el.textContent.trim());
    const metricIcons = all('.metric-icon').map((el) => el.getBoundingClientRect().width);
    const table = document.querySelector('.node-table')?.getBoundingClientRect();
    const tableEl = document.querySelector('.node-table');
    const visibleRows = table ? all('#nodeRows .row').filter((row) => {
      const r = row.getBoundingClientRect();
      return r.bottom > table.top && r.top < table.bottom;
    }).length : 0;
    const badPanels = all('.panel').filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1;
    }).map((el) => el.className);
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      overflowX,
      textOverflow,
      quickEscapes,
      visibleRows,
      tableOverflowX: tableEl ? tableEl.scrollWidth - tableEl.clientWidth : 0,
      maxMetricIcon: Math.max(...metricIcons),
      hero: box('.hero'),
      quick: box('.quick'),
      nodes: box('.nodes'),
      badPanels
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
    await auditViewport(page, 1180, 700)
  ];
  const failures = [];
  for (const report of reports) {
    if (report.overflowX > 1) failures.push(`${report.width}x${report.height}: horizontal overflow ${report.overflowX}px`);
    if (report.tableOverflowX > 1) failures.push(`${report.width}x${report.height}: node table horizontal overflow ${report.tableOverflowX}px`);
    if (report.visibleRows < 5) failures.push(`${report.width}x${report.height}: only ${report.visibleRows} node rows visible`);
    if (report.maxMetricIcon > 24) failures.push(`${report.width}x${report.height}: metric icon width ${report.maxMetricIcon}px`);
    if (report.quickEscapes.length) failures.push(`${report.width}x${report.height}: quick buttons escape container: ${report.quickEscapes.join(', ')}`);
    if (report.badPanels.length) failures.push(`${report.width}x${report.height}: panels outside viewport: ${report.badPanels.join(', ')}`);
    const seriousTextOverflow = report.textOverflow.filter((text) => text && !text.includes('127.0.0.1'));
    if (seriousTextOverflow.length) failures.push(`${report.width}x${report.height}: text overflow: ${seriousTextOverflow.join(', ')}`);
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
