import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failed = [];
const passed = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

function value(text, key) {
  return text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim() || '';
}

function check(name, ok, detail = '') {
  (ok ? passed : failed).push({ name, ok, detail });
}

const plan = read('PLANS.md');
const agents = read('AGENTS.md');
const pkg = JSON.parse(read('package.json'));
const wr01Acceptance = read('tools/wr01-acceptance.js');
const roadmap = read('docs/roadmap.md');
const checkpoint = read('docs/work/current.md');
const product = read('docs/product.md');
const architecture = read('docs/architecture.md');
const index = read('docs/INDEX.md');
const decision = read('docs/decisions/windows-reliability-mainline.md');
const maturityDecision = read('docs/decisions/windows-maturity-mainline.md');
const formerMainline = read('CURRENT_MAINLINE_3.5.71_TO_3.6.40.md');
const phaseAlignment = read('PHASE_1_2_ALIGNMENT_3.5.85.md');
const routingAcceptance = read('ROUTING_PAGE_REAL_USER_ACCEPTANCE_STANDARD.md');
const routingExecution = read('ROUTING_PAGE_REAL_USER_EXECUTION_RECORD.md');
const wm05Evidence = read('docs/work/windows-maturity-wm05.md');
const wr01Evidence = read('docs/work/windows-reliability-wr01.md');
const wr02Evidence = read('docs/work/windows-reliability-wr02.md');

check(
  'the Windows real-use reliability plan is completed with no active authority',
  value(plan, 'plan_id') === 'AEGOS-WINDOWS-RELIABILITY'
    && value(plan, 'status') === 'completed'
    && value(plan, 'authority') === 'none'
    && (plan.match(/^status: active$/gm) || []).length === 0,
  value(plan, 'plan_id')
);

check(
  'WR-01 and WR-02 are completed and CHANGE-030 permits one bounded Git sync',
  value(plan, 'current_task_id') === 'none'
    && plan.includes('| WR-01 | completed |')
    && plan.includes('| WR-02 | completed |')
    && value(plan, 'latest_change_id') === 'CHANGE-030'
    && value(plan, 'latest_change_class') === 'task_adjustment'
    && value(plan, 'continuation_policy') === 'validate_then_advance'
    && value(plan, 'completion_policy') === 'all_required_items'
    && value(plan, 'on_complete') === 'wait'
    && plan.includes('CHANGE-030 is the user\'s explicit request to synchronize the completed 3.6.67')
    && plan.includes('does not authorize a GitHub Release, artifact upload, signing, automatic')
    && checkpoint.includes('CHANGE-030 is the user\'s explicit instruction to synchronize the accepted')
    && checkpoint.includes('It authorizes one commit and push only;')
    && checkpoint.includes('does not authorize a GitHub Release, installer upload, signing, automatic'),
  value(plan, 'current_task_id')
);

check(
  'WR-01 has a fail-closed acceptance integrity contract',
  plan.includes('## Acceptance Integrity Contract')
    && plan.includes('### Evidence Freshness And Identity')
    && plan.includes('### Regression Sensitivity')
    && plan.includes('### Gate Immutability')
    && plan.includes('### Host And Delivery Truth')
    && plan.includes('222 discovered Rust tests')
    && plan.includes('existing 14 UI window/DPI combinations')
    && plan.includes('800-node')
    && plan.includes('420 navigation switches')
    && plan.includes('16 soak cycles')
    && plan.includes('known-bad fixture')
    && agents.includes('## 验收完整性')
    && agents.includes('已知坏 fixture'),
  'fresh evidence, negative controls, immutable matrix floors, and durable agent rules'
);

check(
  'WR-01 execution is ordered from evidence freeze through source-bound delivery',
  ['WR01-A0', 'WR01-A1', 'WR01-A2', 'WR01-A3', 'WR01-A4', 'WR01-A5', 'WR01-A6']
    .every((stage) => plan.includes(`#### ${stage}:`))
    && plan.includes('audit:wr01-acceptance')
    && plan.includes('audit:candidate-provenance -- --require-current')
    && plan.includes('The older 3.6.62 installer may pass structural history checks but')
    && (
      checkpoint.includes('Continue `WR-01` at `WR01-A0`')
      || checkpoint.includes('Continue `WR-01` at the remaining WR01-A1/A2 lifecycle checkpoints')
      || checkpoint.includes('Continue `WR-01` at WR01-A3')
      || checkpoint.includes('Continue CHANGE-027')
      || checkpoint.includes('WR-01 and CHANGE-027 are complete')
      || checkpoint.includes('CHANGE-029 closed the reopened WR-02')
    ),
  'A0-A6 route and source-bound candidate closure'
);

check(
  'WR-01 acceptance runner executes commands and fails closed',
  pkg.scripts?.['audit:wr01-acceptance'] === 'node tools/wr01-acceptance.js'
    && pkg.scripts?.['audit:wr01-run'] === 'node tools/wr01-acceptance.js --run'
    && pkg.scripts?.['audit:wr01-acceptance-fixtures'] === 'node tools/wr01-acceptance.js --self-test'
    && wr01Acceptance.includes("process.argv.includes('--run')")
    && wr01Acceptance.includes("executionStatus: 'executed'")
    && wr01Acceptance.includes('outputSha256')
    && wr01Acceptance.includes('Acceptance report is missing')
    && wr01Acceptance.includes('stale gate digest is rejected')
    && wr01Acceptance.includes('reduced UI matrix is rejected')
    && wr01Acceptance.includes('missing required command is rejected')
    && wr01Acceptance.includes('declared zero exit without execution is rejected')
    && wr01Acceptance.includes('tampered command log is rejected')
    && wr01Acceptance.includes('open P1 is rejected'),
  'execution, log identity, and missing/stale/reduced/command/P1 rejection'
);

check(
  'roadmap stays directional while PLANS owns active authority',
  value(roadmap, 'roadmap_id') === 'AEGOS-WINDOWS-RELIABILITY'
    && value(roadmap, 'execution_authority') === 'none'
    && roadmap.includes('## Ordered Direction')
    && roadmap.includes('The completed WR-01 and CHANGE-029 WR-02 work covered and closed the first two outcomes')
    && roadmap.includes('its current metadata determines whether a task is active'),
  value(roadmap, 'roadmap_id')
);

check(
  'checkpoint records completed WR-02 without gaining execution authority',
  value(checkpoint, 'record_kind') === 'checkpoint'
    && value(checkpoint, 'execution_authority') === 'none'
    && value(checkpoint, 'plan_id') === value(plan, 'plan_id')
    && value(checkpoint, 'current_task_id') === value(plan, 'current_task_id')
    && value(checkpoint, 'latest_change_id') === value(plan, 'latest_change_id')
    && value(checkpoint, 'latest_change_class') === value(plan, 'latest_change_class'),
  value(checkpoint, 'current_task_id')
);

check(
  'the route decision is durable but cannot authorize code itself',
  value(decision, 'decision_id') === 'AEGOS-DEC-2026-07-WINDOWS-RELIABILITY'
    && value(decision, 'status') === 'decided'
    && value(decision, 'execution_authority') === 'none'
    && decision.includes('## Evidence-Based Diagnosis')
    && decision.includes('## Competitor Comparison')
    && decision.includes('## Chosen Sequence'),
  value(decision, 'decision_id')
);

check(
  'completed Windows Maturity records are historical evidence rather than another route',
  value(maturityDecision, 'status') === 'historical'
    && value(maturityDecision, 'execution_authority') === 'none'
    && value(maturityDecision, 'superseded_by') === 'AEGOS-DEC-2026-07-WINDOWS-RELIABILITY'
    && value(wm05Evidence, 'record_kind') === 'evidence_register'
    && value(wm05Evidence, 'execution_authority') === 'none'
    && value(wm05Evidence, 'evidence_state') === 'closed',
  value(maturityDecision, 'status')
);

check(
  'closed WR-01 evidence has one complete finding register and preserves the live limit',
  value(wr01Evidence, 'record_kind') === 'evidence_register'
    && value(wr01Evidence, 'execution_authority') === 'none'
    && value(wr01Evidence, 'plan_id') === value(plan, 'plan_id')
    && value(wr01Evidence, 'task_id') === 'WR-01'
    && value(wr01Evidence, 'evidence_state') === 'closed'
    && ['WR01-001', 'WR01-002', 'WR01-003', 'WR01-004', 'WR01-005', 'WR01-006', 'WR01-007']
      .every((finding) => wr01Evidence.includes(`| ${finding} |`))
    && wr01Evidence.includes('Real Windows')
    && wr01Evidence.includes('explicitly untested environment limit'),
  value(wr01Evidence, 'evidence_state')
);

check(
  'closed WR-02 evidence retains all repaired findings and safety boundaries',
  value(wr02Evidence, 'record_kind') === 'evidence_register'
    && value(wr02Evidence, 'execution_authority') === 'none'
    && value(wr02Evidence, 'plan_id') === value(plan, 'plan_id')
    && value(wr02Evidence, 'task_id') === 'WR-02'
    && value(wr02Evidence, 'evidence_state') === 'closed'
    && ['WR02-001', 'WR02-002', 'WR02-003', 'WR02-004'].every((finding) => wr02Evidence.includes(`| ${finding} | P1 | repaired |`))
    && wr02Evidence.includes('measurement-only')
    && wr02Evidence.includes('FlClash'),
  value(wr02Evidence, 'evidence_state')
);

check(
  'product and architecture keep the reliability-first Windows boundary',
  product.includes('## Windows Reliability Definition')
    && product.includes('not an implicit future queue')
    && architecture.includes('## Reliability Architecture Work')
    && architecture.includes('Mihomo is the managed')
    && architecture.includes('File\nsize and a near-budget count alone never authorize an architecture-only'),
  'product and architecture boundary'
);

check(
  'the active plan excludes unauthorized breadth and distribution work',
  plan.includes('Signing, GitHub publishing')
    && plan.includes('WebDAV, cloud backup')
    && plan.includes('Windows ARM64, macOS, Linux')
    && plan.includes('A second core')
    && plan.includes('broad UI redesign'),
  'scope exclusions'
);

check(
  'the document index identifies the one current plan and archives old direction',
  index.includes('Windows real-use reliability direction')
    && index.includes('decisions/windows-reliability-mainline.md')
    && index.includes('Historical Planning Archive')
    && index.includes('docs/decisions/windows-maturity-mainline.md')
    && index.includes('PLANS.md'),
  'documentation authority'
);

check(
  'former plans and routing records remain non-authoritative',
  formerMainline.includes('历史归档状态')
    && formerMainline.includes('当前唯一可执行计划为 `PLANS.md`')
    && phaseAlignment.includes('历史归档状态')
    && phaseAlignment.includes('当前任务只能由 `PLANS.md` 授权')
    && value(routingAcceptance, 'execution_authority') === 'none'
    && value(routingExecution, 'execution_authority') === 'none',
  'historical authority'
);

const result = {
  ok: failed.length === 0,
  failed,
  passed,
  generatedAt: new Date().toISOString()
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
