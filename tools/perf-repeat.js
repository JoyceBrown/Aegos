import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const runCount = 3;
const reports = [];
const failures = [];

for (let index = 0; index < runCount; index += 1) {
  const run = spawnSync(process.execPath, ['tools/perf-smoke.js'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true
  });
  let report = null;
  try {
    report = JSON.parse(run.stdout || '');
  } catch (error) {
    failures.push(`run ${index + 1} did not return JSON: ${error.message}`);
  }
  if (!report) continue;
  reports.push(report);
  if (run.status !== 0 || report.ok !== true) {
    failures.push(`run ${index + 1} failed: ${(report.failures || []).join('; ') || `exit ${run.status}`}`);
  }
}

const values = (selector) => reports.map(selector).map(Number).filter(Number.isFinite);
const median = (items) => {
  const sorted = [...items].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : Infinity;
};
const worst = (items) => items.length ? Math.max(...items) : Infinity;
const metric = (selector) => {
  const samples = values(selector);
  return { samples, median: median(samples), worst: worst(samples) };
};

const statusContent = metric((report) => report.startup?.statusContentMs);
const homeNodesContent = metric((report) => report.startup?.homeNodesContentMs);
const coldRoutingContent = metric((report) => report.startup?.coldRoutingContentMs);
const routingAfterStatus = metric((report) => report.startup?.routingAfterStatusMs);
const visualNavP95 = metric((report) => report.visualFluidity?.visualNavP95FrameMs);
const visualNavMax = metric((report) => report.visualFluidity?.visualNavMaxFrameMs);
const layoutShift = metric((report) => report.visualFluidity?.unexpectedLayoutShift);

if (reports.length !== runCount) failures.push(`only ${reports.length}/${runCount} reports were collected`);
if (statusContent.median > 250 || statusContent.worst > 350) failures.push(`startup status variability exceeded budget: ${JSON.stringify(statusContent)}`);
if (homeNodesContent.median > 300 || homeNodesContent.worst > 420) failures.push(`home node variability exceeded budget: ${JSON.stringify(homeNodesContent)}`);
if (coldRoutingContent.median > 260 || coldRoutingContent.worst > 350) failures.push(`cold routing variability exceeded budget: ${JSON.stringify(coldRoutingContent)}`);
if (routingAfterStatus.worst > 30) failures.push(`routing prefetch did not immediately follow status: ${JSON.stringify(routingAfterStatus)}`);
if (visualNavP95.median > 35 || visualNavP95.worst > 50 || visualNavMax.worst > 100) failures.push(`visual navigation variability exceeded budget: p95=${JSON.stringify(visualNavP95)} max=${JSON.stringify(visualNavMax)}`);
if (layoutShift.worst > 0.02) failures.push(`layout shift variability exceeded budget: ${JSON.stringify(layoutShift)}`);

const result = {
  ok: failures.length === 0,
  version: pkg.version,
  runCount,
  failures,
  metrics: {
    statusContent,
    homeNodesContent,
    coldRoutingContent,
    routingAfterStatus,
    visualNavP95,
    visualNavMax,
    layoutShift
  },
  generatedAt: new Date().toISOString()
};

fs.writeFileSync(path.join(root, `PERFORMANCE_REPEAT_${pkg.version}.json`), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
