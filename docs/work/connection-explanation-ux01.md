# UX-01 Connection Explanation Evidence Register

record_kind: evidence_register
execution_authority: none
plan_id: AEGOS-WINDOWS-RELIABILITY
task_id: UX-01
change_id: CHANGE-047
evidence_state: closed
version: 3.6.70
source_baseline: 941d1f6fc591a0c89709948a42e4e6a6cbcf5564
validation_window_utc: 2026-07-28T10:08:39Z to 2026-07-28T10:13:09Z

## Scope And Result

The Connections page now exposes a compact `详情` command beside the selected
target. It opens one inline, read-only explanation from the current normalized
connection snapshot: target, matched rule, managed route, process, and
transport. The primary page remains default-hidden and no detail is retained
after refresh or navigation.

The interaction fixture verifies default-hidden, one selected explanation at a
time, no backend request, refresh close, navigation close, and compatibility
with the existing routing-draft and close actions. The UI fixture verifies the
default-hidden state and the expanded detail against the table boundary at the
existing 14 fixed window/DPI configurations. It independently verifies the
existing action column and the new detail trigger, so the new trigger cannot
weaken the prior action-geometry check.

## Final Commands

All commands below exited 0 against the stated baseline and dirty worktree.

| Command | Result |
| --- | --- |
| `node --check src/app.js` | passed |
| `node --check tools/interaction-smoke.js` | passed |
| `node --check tools/ui-smoke.js` | passed |
| `git diff --check` | passed; only pre-existing CRLF advisory output |
| `npm run smoke:interactions` | passed; `PRODUCT_SMOKE_3.6.70.json` generated at 2026-07-28T10:13:00.433Z with all 13 journeys and zero forbidden side effects |
| `npm run smoke:ui` | passed; all 14 fixed window/DPI reports have no horizontal overflow, no clipped connection action, no default-visible detail, and no escaping detail |
| `npm run smoke:perf:stress` | passed; 800 nodes, 420 navigations, connection exit cancellation, and no failures (`PERFORMANCE_PRESSURE_3.6.70.json`) |
| `npm run smoke:soak` | passed; 16 cycles, 262 commands, stable final page/timers, and no failures (`PERFORMANCE_SOAK_3.6.70.json`) |
| `npm run audit:connection-closure` | passed |
| `npm run audit:responsiveness` | passed; cold Connections rendering retains token/generation cancellation and main-thread yields |
| `npm run audit:security` | passed |
| `npm run audit:control-plane` | passed |
| `npm run audit:architecture` | passed |
| `npm run audit:planning-context` | passed |

## Worktree And Safety Boundary

The worktree was already dirty before UX-01, including prior source, release,
performance evidence, tool, and work-register changes. UX-01 changed only the
connection explanation UI, its focused interaction/UI checks, the product and
plan/checkpoint authority records, and this evidence register. Unrelated dirty
changes were retained.

No installer, Git, publication, FlClash, or host-network action occurred. No
host proxy, TUN, DNS, firewall, kill-switch, Controller, or runtime YAML state
was read, changed, or exposed by UX-01.
