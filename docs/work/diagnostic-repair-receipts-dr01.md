# DR-01 Diagnostic Repair Receipt Evidence Register

record_kind: evidence_register
execution_authority: none
plan_id: AEGOS-WINDOWS-RELIABILITY
task_id: DR-01
change_id: CHANGE-048
evidence_state: closed
version: 3.6.70
source_baseline: 941d1f6fc591a0c89709948a42e4e6a6cbcf5564
validation_window_utc: 2026-07-28T10:27:00Z to 2026-07-28T10:31:00Z

## Scope And Result

DR-01 preserves the existing Diagnostics execution path: the user explicitly
chooses a repair, Aegos runs the existing background repair command, refreshes
status, and runs diagnostics again. It adds no repair command, polling, or
network behavior. The repaired item now retains an in-session receipt after
that recheck:

- `verified`: the returned item is normal.
- `unresolved`: the returned item still reports the issue.
- `unverified`: the recheck did not return the original diagnostic code, so
  Aegos keeps a read-only item-scoped explanation rather than claiming success.

Receipts are default-absent, survive ordinary page navigation in the current
session, and clear immediately on an explicit new diagnostic run. The receipt
does not cover an action that relaunches Aegos as administrator because that
operation exits the current process before a same-session recheck can occur.

## Final Commands

All commands below exited 0 against the stated baseline and retained dirty
worktree.

| Command | Result |
| --- | --- |
| `node --check src/app.js` | passed |
| `node --check tools/interaction-smoke.js` | passed |
| `node --check tools/ui-smoke.js` | passed |
| `git diff --check` | passed; only pre-existing CRLF advisory output |
| `npm run smoke:interactions` | passed; fixture proves default-absent, verified, unresolved, unverified, navigation persistence, explicit-run clearing, and navigation while diagnostics runs |
| `npm run smoke:ui` | passed; all 14 fixed window/DPI reports keep the receipt inside its diagnostic row without horizontal overflow |
| `npm run smoke:perf:stress` | passed; 800 nodes, 420 navigations, no failures (`PERFORMANCE_PRESSURE_3.6.70.json`, generated 2026-07-28T10:29:18.639Z) |
| `npm run smoke:soak` | passed; 16 cycles, stable resource samples, no failures (`PERFORMANCE_SOAK_3.6.70.json`) |
| `npm run audit:responsiveness` | passed |
| `npm run audit:security` | passed |
| `npm run audit:control-plane` | passed |
| `npm run audit:architecture` | passed |
| `npm run audit:planning-context` | passed |

## Worktree And Safety Boundary

The worktree was already dirty before DR-01, including prior source, tool,
release evidence, and work-register changes. DR-01 changed only the in-session
diagnostic receipt, its focused interaction/UI checks, the product and plan
authority records, and this evidence register. Unrelated dirty changes were
retained.

No installer, Git, publication, FlClash, or host-network action occurred. No
host proxy, TUN, DNS, firewall, kill-switch, Controller, or runtime YAML state
was read, changed, or exposed by DR-01.
