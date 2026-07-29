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
const wr03Evidence = read('docs/work/windows-reliability-wr03.md');
const wr04Evidence = read('docs/work/windows-reliability-wr04.md');
const wr05Evidence = read('docs/work/windows-reliability-wr05.md');
const wr06Evidence = read('docs/work/windows-reliability-wr06.md');
const wr08Evidence = read('docs/work/windows-reliability-wr08.md');
const wr09Evidence = read('docs/work/windows-reliability-wr09.md');
const wr10Evidence = read('docs/work/windows-reliability-wr10.md');
const wr11Evidence = read('docs/work/windows-reliability-wr11.md');
const wr12Evidence = read('docs/work/windows-reliability-wr12.md');
const wr13Evidence = read('docs/work/windows-reliability-wr13.md');
const wr14Evidence = read('docs/work/windows-reliability-wr14.md');
const ux01Evidence = read('docs/work/connection-explanation-ux01.md');
const dr01Evidence = read('docs/work/diagnostic-repair-receipts-dr01.md');
const br01Evidence = read('docs/work/backup-restore-identity-br01.md');
const rel01Evidence = read('docs/work/release-3.6.70-rel01.md');
const lic01Evidence = read('docs/work/license-packaging-lic01.md');
const dg01Evidence = read('docs/work/delivery-governance-dg01.md');

const wr15Active = value(plan, 'status') === 'active'
  && value(plan, 'authority') === 'exclusive'
  && value(plan, 'current_task_id') === 'WR-15'
  && value(plan, 'latest_change_id') === 'CHANGE-046'
  && plan.includes('CHANGE-046 is the user\'s explicit instruction to process the complete')
  && plan.includes('routing contract')
  && plan.includes('Repair static audit drift only')
  && plan.includes('full host-safe WR-01 acceptance matrix')
  && plan.includes('WR-15 excludes network behavior changes');
const wr15Closed = value(plan, 'status') === 'completed'
  && value(plan, 'authority') === 'none'
  && value(plan, 'current_task_id') === 'WR-15'
  && value(plan, 'latest_change_id') === 'CHANGE-046'
  && plan.includes('CHANGE-046 is the user\'s explicit instruction to process the complete')
  && plan.includes('WR-15 is complete only with the current acceptance report')
  && plan.includes('WR-15 excludes network behavior changes');
const wr15FollowOn = wr15Active || wr15Closed;
const ux01Contract = value(plan, 'current_task_id') === 'UX-01'
  && value(plan, 'latest_change_id') === 'CHANGE-047'
  && plan.includes('CHANGE-047 is the user\'s explicit approval of UX-01')
  && plan.includes('one inline, currently selected connection explanation at a time')
  && plan.includes('UX-01 excludes home-page copy, status-center expansion, new background polling');
const ux01Active = value(plan, 'status') === 'active'
  && value(plan, 'authority') === 'exclusive'
  && ux01Contract;
const ux01Closed = value(plan, 'status') === 'completed'
  && value(plan, 'authority') === 'none'
  && ux01Contract
  && plan.includes('UX-01 is complete only with the evidence register');
const ux01FollowOn = ux01Active || ux01Closed;
const dr01Contract = value(plan, 'current_task_id') === 'DR-01'
  && value(plan, 'latest_change_id') === 'CHANGE-048'
  && plan.includes('CHANGE-048 is the user\'s explicit approval of DR-01')
  && plan.includes('an in-memory, item-scoped repair receipt')
  && plan.includes('DR-01 excludes new repair actions, automatic repair, background polling');
const dr01Active = value(plan, 'status') === 'active'
  && value(plan, 'authority') === 'exclusive'
  && dr01Contract;
const dr01Closed = value(plan, 'status') === 'completed'
  && value(plan, 'authority') === 'none'
  && dr01Contract
  && plan.includes('DR-01 is complete only with the evidence register');
const dr01FollowOn = dr01Active || dr01Closed;
const br01Contract = value(plan, 'current_task_id') === 'BR-01'
  && value(plan, 'latest_change_id') === 'CHANGE-049'
  && plan.includes('CHANGE-049 is the user\'s explicit approval of BR-01')
  && plan.includes('Make a destructive local-backup restore confirmation identify the exact');
const br01Active = value(plan, 'status') === 'active'
  && value(plan, 'authority') === 'exclusive'
  && br01Contract;
const br01Closed = value(plan, 'status') === 'completed'
  && value(plan, 'authority') === 'none'
  && br01Contract
  && plan.includes('BR-01 is complete only with the evidence register');
const br01FollowOn = br01Active || br01Closed;
const rel01Contract = value(plan, 'current_task_id') === 'REL-01'
  && value(plan, 'latest_change_id') === 'CHANGE-050'
  && plan.includes('CHANGE-050 is the user\'s explicit approval of REL-01')
  && plan.includes('Build and publish the exact source-bound `v3.6.70` unsigned x64 NSIS installer');
const rel01Active = value(plan, 'status') === 'active'
  && value(plan, 'authority') === 'exclusive'
  && rel01Contract;
const rel01Closed = value(plan, 'status') === 'completed'
  && value(plan, 'authority') === 'none'
  && rel01Contract
  && plan.includes('REL-01 is complete only with the evidence register');
const rel01FollowOn = rel01Active || rel01Closed;
const lic01Contract = value(plan, 'current_task_id') === 'LIC-01'
  && value(plan, 'latest_change_id') === 'CHANGE-051'
  && value(plan, 'latest_change_class') === 'priority_branch'
  && plan.includes('Complete LIC-01 as one release-governance unit')
  && plan.includes('Aegos and its next installer carry complete GPL-3.0-only')
  && plan.includes('local-only source-bound unsigned v3.6.71');
const lic01Active = value(plan, 'status') === 'active'
  && value(plan, 'authority') === 'exclusive'
  && lic01Contract;
const lic01Closed = value(plan, 'status') === 'completed'
  && value(plan, 'authority') === 'none'
  && lic01Contract
  && plan.includes('LIC-01 is complete only when `docs/work/license-packaging-lic01.md` is closed');
const lic01FollowOn = lic01Active || lic01Closed;
const dg01Contract = value(plan, 'current_task_id') === 'DG-01'
  && value(plan, 'latest_change_id') === 'CHANGE-052'
  && value(plan, 'latest_change_class') === 'priority_branch'
  && plan.includes('Complete DG-01 as one bounded delivery-readiness unit')
  && plan.includes('source/license and CI delivery commits plus one')
  && plan.includes('minimal Windows CI lane')
  && plan.includes('every FlClash action')
  && plan.includes('remain excluded');
const dg01Active = value(plan, 'status') === 'active'
  && value(plan, 'authority') === 'exclusive'
  && dg01Contract;
const dg01Closed = value(plan, 'status') === 'completed'
  && value(plan, 'authority') === 'none'
  && dg01Contract;
const dg01FollowOn = dg01Active || dg01Closed;
const authorizedFollowOn = wr15FollowOn || ux01FollowOn || dr01FollowOn || br01FollowOn || rel01FollowOn || lic01FollowOn || dg01FollowOn;

check(
  'the local-installer route preserves completed R5 evidence and a bounded active follow-on when authorized',
  value(plan, 'plan_id') === 'AEGOS-WINDOWS-RELIABILITY'
    && plan.includes('local-only `3.6.70` x64 NSIS candidate')
    && plan.includes('does not authorize installation, Git commits or pushes')
    && plan.includes('CHANGE-039 is the user\'s explicit instruction')
    && plan.includes('visible pending rows')
    && plan.includes('CHANGE-040 is the user\'s explicit instruction')
    && plan.includes('truthful handling of a background')
    && plan.includes('CHANGE-041 is the user\'s explicit instruction')
    && plan.includes('display reads that can be delayed by a core write operation')
    && plan.includes('CHANGE-042 is the user\'s explicit instruction')
    && plan.includes('CHANGE-043 is the user\'s explicit instruction')
    && plan.includes('speed-test result presentation')
    && plan.includes('CHANGE-044 is the user\'s explicit instruction')
    && plan.includes('Rules page\'s heavy read-only snapshot path')
    && plan.includes('CHANGE-045 is the user\'s explicit request for an installer')
    && plan.includes('local-only, unsigned `3.6.70` x64 NSIS candidate')
    && plan.includes('or any host proxy, TUN, DNS, firewall, or kill-switch action')
    && (
      (value(plan, 'status') === 'completed'
        && value(plan, 'authority') === 'none'
        && value(plan, 'current_task_id') === 'WR-14'
        && value(plan, 'latest_change_id') === 'CHANGE-045')
      || authorizedFollowOn
    ),
  value(plan, 'status')
);

check(
  'WR-01 through WR-14 remain complete while only a bounded authorized follow-on may be active',
  plan.includes('| WR-01 | completed |')
    && plan.includes('| WR-02 | completed |')
    && plan.includes('| WR-03 | completed |')
    && plan.includes('| WR-04 | completed |')
    && plan.includes('| WR-05 | completed |')
    && plan.includes('| WR-06 | completed |')
    && plan.includes('| WR-07 | completed |')
    && plan.includes('| WR-08 | completed |')
    && plan.includes('| WR-09 | completed |')
    && plan.includes('| WR-10 | completed |')
    && plan.includes('| WR-11 | completed |')
    && plan.includes('| WR-12 | completed |')
    && plan.includes('| WR-13 | completed |')
    && plan.includes('| WR-14 | completed |')
    && (((lic01FollowOn || dg01FollowOn) && value(plan, 'latest_change_class') === 'priority_branch')
      || (!lic01FollowOn && !dg01FollowOn && value(plan, 'latest_change_class') === 'task_adjustment'))
    && value(plan, 'continuation_policy') === 'validate_then_advance'
    && value(plan, 'completion_policy') === 'all_required_items'
    && value(plan, 'on_complete') === 'wait'
    && plan.includes('CHANGE-032 is the user\'s explicit instruction')
    && plan.includes('CHANGE-033 is the user\'s explicit instruction')
    && plan.includes('CHANGE-034 is the user\'s explicit instruction')
    && plan.includes('CHANGE-035 is the user\'s explicit correction')
    && plan.includes('CHANGE-036 is the user\'s post-release report')
    && plan.includes('truthful connected')
    && plan.includes('truthful separation of effective')
    && plan.includes('must not replace the existing')
    && plan.includes('v3.6.67')
    && plan.includes('source-bound unsigned')
    && plan.includes('3.6.68')
    && plan.includes('NSIS installer')
    && plan.includes('10/30-minute measurement')
    && plan.includes('variance around a rolling average')
    && ((value(plan, 'latest_change_id') === 'CHANGE-045'
      && value(checkpoint, 'latest_change_id') === 'CHANGE-045'
      && value(checkpoint, 'current_task_id') === 'WR-14')
      || (wr15FollowOn
        && plan.includes('| WR-15 | ')
        && value(checkpoint, 'latest_change_id') === 'CHANGE-046'
        && value(checkpoint, 'current_task_id') === 'WR-15'
        && value(checkpoint, 'execution_authority') === value(plan, 'authority')
        && checkpoint.includes('CHANGE-046 / WR-15'))
      || (ux01FollowOn
        && plan.includes('| UX-01 | ')
        && value(checkpoint, 'latest_change_id') === 'CHANGE-047'
        && value(checkpoint, 'current_task_id') === 'UX-01'
        && value(checkpoint, 'execution_authority') === value(plan, 'authority')
        && checkpoint.includes('CHANGE-047 / UX-01'))
      || (dr01FollowOn
        && plan.includes('| DR-01 | ')
        && value(checkpoint, 'latest_change_id') === 'CHANGE-048'
        && value(checkpoint, 'current_task_id') === 'DR-01'
        && value(checkpoint, 'execution_authority') === value(plan, 'authority')
        && checkpoint.includes('CHANGE-048 / DR-01'))
      || (br01FollowOn
        && plan.includes('| BR-01 | ')
        && value(checkpoint, 'latest_change_id') === 'CHANGE-049'
        && value(checkpoint, 'current_task_id') === 'BR-01'
        && value(checkpoint, 'execution_authority') === value(plan, 'authority')
        && checkpoint.includes('CHANGE-049 / BR-01'))
      || (rel01FollowOn
        && plan.includes('| REL-01 | ')
        && value(checkpoint, 'latest_change_id') === 'CHANGE-050'
        && value(checkpoint, 'current_task_id') === 'REL-01'
        && value(checkpoint, 'execution_authority') === value(plan, 'authority')
        && checkpoint.includes('CHANGE-050 / REL-01'))
      || (lic01FollowOn
        && plan.includes('| LIC-01 | ')
        && value(checkpoint, 'latest_change_id') === 'CHANGE-051'
        && value(checkpoint, 'current_task_id') === 'LIC-01'
        && value(checkpoint, 'execution_authority') === 'none'
        && checkpoint.includes('CHANGE-051 / LIC-01'))
      || (dg01FollowOn
        && plan.includes('| DG-01 | ')
        && value(checkpoint, 'latest_change_id') === 'CHANGE-052'
        && value(checkpoint, 'current_task_id') === 'DG-01'
        && value(checkpoint, 'execution_authority') === 'none'
        && checkpoint.includes('CHANGE-052 / DG-01')))
    && checkpoint.includes('CHANGE-037 was a narrow post-release UI repair')
    && checkpoint.includes('CHANGE-039 / WR-08 is complete')
    && value(wr05Evidence, 'evidence_state') === 'closed'
    && wr05Evidence.includes('Aegos_3.6.68_x64-setup.exe')
    && wr05Evidence.includes('839804d895d4c5af77568e2e876407a6b29f17bf33fdd9e771165ea387b7ade4')
    && value(wr06Evidence, 'evidence_state') === 'closed'
    && wr06Evidence.includes('Aegos_3.6.69_x64-setup.exe')
    && wr06Evidence.includes('a85a8335ce67c6fa30fe8cca9eeeb89aa9198dd9fa76086b5a84d8cf3789a4cd'),
  value(plan, 'status')
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
  'checkpoint mirrors the single plan authority and current bounded task',
  value(checkpoint, 'record_kind') === 'checkpoint'
    && value(checkpoint, 'execution_authority') === 'none'
    && value(checkpoint, 'plan_id') === value(plan, 'plan_id')
    && value(checkpoint, 'current_task_id') === value(plan, 'current_task_id')
    && value(checkpoint, 'latest_change_id') === value(plan, 'latest_change_id')
    && value(checkpoint, 'latest_change_class') === value(plan, 'latest_change_class'),
  value(checkpoint, 'current_task_id')
);

check(
  'closed UX-01 evidence preserves the on-demand connection boundary and final matrix',
  !ux01Closed || (
    value(ux01Evidence, 'record_kind') === 'evidence_register'
    && value(ux01Evidence, 'execution_authority') === 'none'
    && value(ux01Evidence, 'plan_id') === value(plan, 'plan_id')
    && value(ux01Evidence, 'task_id') === 'UX-01'
    && value(ux01Evidence, 'change_id') === 'CHANGE-047'
    && value(ux01Evidence, 'evidence_state') === 'closed'
    && ux01Evidence.includes('default-hidden')
    && ux01Evidence.includes('no backend request')
    && ux01Evidence.includes('fixed window/DPI')
    && ux01Evidence.includes('npm run smoke:interactions')
    && ux01Evidence.includes('npm run smoke:ui')
    && ux01Evidence.includes('npm run smoke:perf:stress')
    && ux01Evidence.includes('npm run smoke:soak')
    && ux01Evidence.includes('No installer, Git, publication, FlClash, or host-network action occurred')
  ),
  value(ux01Evidence, 'evidence_state')
);

check(
  'closed DR-01 evidence preserves diagnostic repair truth and the final matrix',
  !dr01Closed || (
    value(dr01Evidence, 'record_kind') === 'evidence_register'
    && value(dr01Evidence, 'execution_authority') === 'none'
    && value(dr01Evidence, 'plan_id') === value(plan, 'plan_id')
    && value(dr01Evidence, 'task_id') === 'DR-01'
    && value(dr01Evidence, 'change_id') === 'CHANGE-048'
    && value(dr01Evidence, 'evidence_state') === 'closed'
    && dr01Evidence.includes('default-absent')
    && dr01Evidence.includes('verified')
    && dr01Evidence.includes('unresolved')
    && dr01Evidence.includes('unverified')
    && dr01Evidence.includes('npm run smoke:interactions')
    && dr01Evidence.includes('npm run smoke:ui')
    && dr01Evidence.includes('npm run smoke:perf:stress')
    && dr01Evidence.includes('npm run smoke:soak')
    && dr01Evidence.includes('No installer, Git, publication, FlClash, or host-network action occurred')
  ),
  value(dr01Evidence, 'evidence_state')
);

check(
  'closed BR-01 evidence preserves selected-backup identity and the final matrix',
  !br01Closed || (
    value(br01Evidence, 'record_kind') === 'evidence_register'
    && value(br01Evidence, 'execution_authority') === 'none'
    && value(br01Evidence, 'plan_id') === value(plan, 'plan_id')
    && value(br01Evidence, 'task_id') === 'BR-01'
    && value(br01Evidence, 'change_id') === 'CHANGE-049'
    && value(br01Evidence, 'evidence_state') === 'closed'
    && br01Evidence.includes('selected-backup identity')
    && br01Evidence.includes('cancellation')
    && br01Evidence.includes('npm run smoke:interactions')
    && br01Evidence.includes('npm run smoke:ui')
    && br01Evidence.includes('No installer, Git, publication, FlClash, or host-network action occurred')
  ),
  value(br01Evidence, 'evidence_state')
);

check(
  'closed REL-01 evidence binds the fresh artifact, source sync, and GitHub asset',
  !rel01Closed || (
    value(rel01Evidence, 'record_kind') === 'evidence_register'
    && value(rel01Evidence, 'execution_authority') === 'none'
    && value(rel01Evidence, 'plan_id') === value(plan, 'plan_id')
    && value(rel01Evidence, 'task_id') === 'REL-01'
    && value(rel01Evidence, 'change_id') === 'CHANGE-050'
    && value(rel01Evidence, 'evidence_state') === 'closed'
    && rel01Evidence.includes('source-bound')
    && rel01Evidence.includes('GitHub Release')
    && rel01Evidence.includes('unsigned')
    && rel01Evidence.includes('SHA-256')
  ),
  value(rel01Evidence, 'evidence_state')
);

check(
  'LIC-01 evidence binds the GPL, exact Mihomo origin, fail-closed gates, and local candidate payload',
  !lic01Closed || (
    value(lic01Evidence, 'evidence_state') === 'closed'
    && value(lic01Evidence, 'execution_authority') === 'none'
    && value(lic01Evidence, 'task_id') === 'LIC-01'
    && value(lic01Evidence, 'version') === '3.6.71'
    && lic01Evidence.includes('GPL-3.0-only')
    && lic01Evidence.includes('mihomo-windows-amd64-v1-v1.19.28.zip')
    && lic01Evidence.includes('THIRD_PARTY_NOTICES.md')
    && lic01Evidence.includes('actual NSIS payload')
    && lic01Evidence.includes('32-command')
    && lic01Evidence.includes('NotSigned')
    && lic01Evidence.includes('uninstalled')
    && lic01Evidence.includes('unpublished')
  ),
  value(lic01Evidence, 'status')
);

check(
  'DG-01 evidence preserves source closure, lab permission boundary, CI scope, and host exclusions',
  !dg01FollowOn || (
    value(dg01Evidence, 'record_kind') === 'evidence_register'
    && value(dg01Evidence, 'execution_authority') === 'none'
    && value(dg01Evidence, 'task_id') === 'DG-01'
    && value(dg01Evidence, 'change_id') === 'CHANGE-052'
    && ((dg01Active && value(dg01Evidence, 'evidence_state') === 'in_progress')
      || (dg01Closed && value(dg01Evidence, 'evidence_state') === 'closed'))
    && dg01Evidence.includes('90a17ea')
    && dg01Evidence.includes('Hyper-V Administrators')
    && dg01Evidence.includes('Windows Sandbox')
    && dg01Evidence.includes('.github/workflows/windows-ci.yml')
    && dg01Evidence.includes('every FlClash action are excluded')
  ),
  value(dg01Evidence, 'evidence_state')
);

check(
  'closed WR-14 evidence binds the local candidate to fresh acceptance without delivery side effects',
  value(wr14Evidence, 'record_kind') === 'evidence_register'
    && value(wr14Evidence, 'execution_authority') === 'none'
    && value(wr14Evidence, 'task_id') === 'WR-14'
    && value(wr14Evidence, 'change_id') === 'CHANGE-045'
    && value(wr14Evidence, 'evidence_state') === 'closed'
    && value(wr14Evidence, 'validation_run_id') === 'wr01-20260728080142-17376'
    && wr14Evidence.includes('Aegos_3.6.70_x64-setup.exe')
    && wr14Evidence.includes('d68c431ebac8c1ba2649810845b7110e536706d784b951a6e16ea9820c0319b0')
    && wr14Evidence.includes('NotSigned')
    && wr14Evidence.includes('candidate was neither installed nor published')
    && wr14Evidence.includes('host-network action'),
  value(wr14Evidence, 'evidence_state')
);

check(
  'closed WR-08 evidence preserves both responsiveness bad controls and delivery exclusions',
  value(wr08Evidence, 'record_kind') === 'evidence_register'
    && value(wr08Evidence, 'execution_authority') === 'none'
    && value(wr08Evidence, 'task_id') === 'WR-08'
    && value(wr08Evidence, 'change_id') === 'CHANGE-039'
    && value(wr08Evidence, 'evidence_state') === 'closed'
    && wr08Evidence.includes('startup prewarm forced layout reads: 3')
    && wr08Evidence.includes('hidden pending row')
    && wr08Evidence.includes('prewarmLayoutReads=0')
    && wr08Evidence.includes('hidden-speed-probe')
    && wr08Evidence.includes('No installer, release, Git operation, or external side effect'),
  value(wr08Evidence, 'evidence_state')
);

check(
  'closed WR-09 evidence preserves the long-job bad control and real terminal recovery',
  value(wr09Evidence, 'record_kind') === 'evidence_register'
    && value(wr09Evidence, 'execution_authority') === 'none'
    && value(wr09Evidence, 'task_id') === 'WR-09'
    && value(wr09Evidence, 'change_id') === 'CHANGE-040'
    && value(wr09Evidence, 'evidence_state') === 'closed'
    && wr09Evidence.includes('data-busy=true')
    && wr09Evidence.includes('same Job ID')
    && wr09Evidence.includes('does not issue another `start_job` call')
    && wr09Evidence.includes('No installer, release, commit, push, GitHub action'),
  value(wr09Evidence, 'evidence_state')
);

check(
  'closed WR-10 evidence preserves snapshot truth, cold loading, and old-path rejection',
  value(wr10Evidence, 'record_kind') === 'evidence_register'
    && value(wr10Evidence, 'execution_authority') === 'none'
    && value(wr10Evidence, 'task_id') === 'WR-10'
    && value(wr10Evidence, 'change_id') === 'CHANGE-041'
    && value(wr10Evidence, 'evidence_state') === 'closed'
    && wr10Evidence.includes('nodeSnapshotDiscarded: true')
    && wr10Evidence.includes('matching active profile')
    && wr10Evidence.includes('No CoreManager lock replacement'),
  value(wr10Evidence, 'evidence_state')
);

check(
  'closed WR-11 evidence preserves stale-prewarm rejection and the terminal button repair',
  value(wr11Evidence, 'record_kind') === 'evidence_register'
    && value(wr11Evidence, 'execution_authority') === 'none'
    && value(wr11Evidence, 'task_id') === 'WR-11'
    && value(wr11Evidence, 'change_id') === 'CHANGE-042'
    && value(wr11Evidence, 'evidence_state') === 'closed'
    && wr11Evidence.includes('stalePrewarmAfterNavigation: true')
    && wr11Evidence.includes('stalePrewarmAfterNavigation: false')
    && wr11Evidence.includes('derived connection button'),
  value(wr11Evidence, 'evidence_state')
);

check(
  'closed WR-12 evidence preserves hidden-row rejection and immediate speed feedback',
  value(wr12Evidence, 'record_kind') === 'evidence_register'
    && value(wr12Evidence, 'execution_authority') === 'none'
    && value(wr12Evidence, 'task_id') === 'WR-12'
    && value(wr12Evidence, 'change_id') === 'CHANGE-043'
    && value(wr12Evidence, 'evidence_state') === 'closed'
    && wr12Evidence.includes('hiddenPendingCellWasWritten: true')
    && wr12Evidence.includes('hiddenPendingCellWasWritten: false')
    && wr12Evidence.includes('frame-coalesced'),
  value(wr12Evidence, 'evidence_state')
);

check(
  'closed WR-13 evidence preserves the 80,000-rule stale-DOM rejection and repaired cancellation',
  value(wr13Evidence, 'record_kind') === 'evidence_register'
    && value(wr13Evidence, 'execution_authority') === 'none'
    && value(wr13Evidence, 'task_id') === 'WR-13'
    && value(wr13Evidence, 'change_id') === 'CHANGE-044'
    && value(wr13Evidence, 'evidence_state') === 'closed'
    && wr13Evidence.includes('staleSnapshotCommitted: true')
    && wr13Evidence.includes('staleSnapshotCommitted: false')
    && wr13Evidence.includes('No snapshot service was extracted'),
  value(wr13Evidence, 'evidence_state')
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
  'closed WR-03 evidence retains every repaired current-code P1/P2 finding',
  value(wr03Evidence, 'record_kind') === 'evidence_register'
    && value(wr03Evidence, 'execution_authority') === 'none'
    && value(wr03Evidence, 'plan_id') === value(plan, 'plan_id')
    && value(wr03Evidence, 'task_id') === 'WR-03'
    && value(wr03Evidence, 'change_id') === 'CHANGE-032'
    && value(wr03Evidence, 'evidence_state') === 'closed'
    && ['WR03-001', 'WR03-002', 'WR03-003', 'WR03-004', 'WR03-005', 'WR03-006']
      .every((finding) => wr03Evidence.includes(`| ${finding} |`))
    && wr03Evidence.includes('known-bad')
    && wr03Evidence.includes('No P1 remains open')
    && wr03Evidence.includes('FlClash'),
  value(wr03Evidence, 'evidence_state')
);

check(
  'closed WR-04 evidence preserves every UI truth and accessibility control',
  value(wr04Evidence, 'record_kind') === 'evidence_register'
    && value(wr04Evidence, 'execution_authority') === 'none'
    && value(wr04Evidence, 'plan_id') === value(plan, 'plan_id')
    && value(wr04Evidence, 'task_id') === 'WR-04'
    && value(wr04Evidence, 'change_id') === 'CHANGE-033'
    && value(wr04Evidence, 'evidence_state') === 'closed'
    && ['WR04-001', 'WR04-002', 'WR04-003', 'WR04-004', 'WR04-005', 'WR04-006']
      .every((finding) => wr04Evidence.includes(`| ${finding} |`))
    && wr04Evidence.includes('known-bad')
    && wr04Evidence.includes('No P1 remains open')
    && wr04Evidence.includes('FlClash'),
  value(wr04Evidence, 'evidence_state')
);

check(
  'closed WR-06 evidence preserves vocabulary, stability, and published artifact facts',
  value(wr06Evidence, 'record_kind') === 'evidence_register'
    && value(wr06Evidence, 'execution_authority') === 'none'
    && value(wr06Evidence, 'plan_id') === value(plan, 'plan_id')
    && value(wr06Evidence, 'task_id') === 'WR-06'
    && value(wr06Evidence, 'change_id') === 'CHANGE-035'
    && value(wr06Evidence, 'evidence_state') === 'closed'
    && ['WR06-001', 'WR06-002', 'WR06-003', 'WR06-004']
      .every((finding) => wr06Evidence.includes(`| ${finding} |`))
    && wr06Evidence.includes('10/30-minute')
    && wr06Evidence.includes('a85a8335ce67c6fa30fe8cca9eeeb89aa9198dd9fa76086b5a84d8cf3789a4cd')
    && wr06Evidence.includes('FlClash'),
  value(wr06Evidence, 'evidence_state')
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
  'the completed plan retains its unauthorized breadth and distribution exclusions',
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
