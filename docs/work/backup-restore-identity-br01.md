# BR-01 Evidence Register

record_kind: evidence_register
execution_authority: none
plan_id: AEGOS-WINDOWS-RELIABILITY
task_id: BR-01
change_id: CHANGE-049
evidence_state: closed
version: 3.6.70
source_baseline: 941d1f6fc591a0c89709948a42e4e6a6cbcf5564
validation_window_utc: 2026-07-28T10:42:00Z to 2026-07-28T10:48:00Z

## Scope

BR-01 is limited to identifying the selected local encrypted backup in the
existing destructive restore confirmation. It does not change backup contents,
DPAPI protection, archive validation, rollback, the disconnected-only rule,
the existing `restoreLocalBackup` job, network behavior, or delivery.

## Required Evidence

- A selected-backup identity appears in the confirmation before approval.
- Cancellation starts no restore job.
- Confirmation starts the existing `restoreLocalBackup` background job with
  the selected identifier.
- The confirmation fits the existing fixed window/DPI matrix.
- Focused interaction, UI, performance, soak, and affected host-safe audits
  run against final source before this record is closed.

## Result

The list now uses one identity formatter for the backup row and confirmation:
creation time, encrypted archive size, and item count only when the existing
snapshot supplies a nonzero count. It does not decrypt a listed archive merely
to render the dialog, so existing snapshot-read latency and lock scope do not
change.

The focused bad path is retained in interaction smoke: a confirmation lacking
the selected backup's size and item count is rejected; a cancelled confirmation
must issue no `restoreLocalBackup` job. The repaired path confirms the same
existing job kind and selected ID. The fixed UI fixture opens the confirmation
at every existing window/DPI size and rejects clipping or a missing identity.

## Final Commands

All commands below exited 0 against the stated baseline and retained dirty
worktree.

| Command | Result |
| --- | --- |
| `node --check src/app.js` | passed |
| `node --check tools/interaction-smoke.js` | passed |
| `node --check tools/ui-smoke.js` | passed |
| `node --check tools/planning-context-audit.js` | passed |
| `git diff --check` | passed; only pre-existing CRLF advisory output |
| `npm run smoke:interactions` | passed; proves selected-backup identity, cancellation, confirmation, original restore job identity, and connected restore blocking |
| `npm run smoke:ui` | passed; all 14 fixed window/DPI reports include the confirmation and reject a missing identity or viewport clipping |
| `npm run smoke:perf:stress` | passed; 800 nodes, 420 navigations, no failures (`PERFORMANCE_PRESSURE_3.6.70.json`, generated 2026-07-28T10:46:30.864Z) |
| `npm run smoke:soak` | passed; 16 cycles, stable resource samples, no failures (`PERFORMANCE_SOAK_3.6.70.json`) |
| `npm run audit:local-backup` | passed |
| `npm run audit:backend` | passed |
| `npm run audit:responsiveness` | passed |
| `npm run audit:security` | passed |
| `npm run audit:control-plane` | passed |
| `npm run audit:architecture` | passed |
| `npm run audit:connection-closure` | passed |
| `npm run audit:planning-context` | passed after BR-01 closure; evidence and authority state agree |

## Worktree And Safety Boundary

The worktree was already dirty before BR-01, including prior source, tool,
release evidence, and work-register changes. BR-01 changed only the local
backup confirmation identity, focused interaction/UI checks, the product and
plan authority records, and this evidence register. Unrelated dirty changes
were retained.

No installer, Git, publication, FlClash, or host-network action occurred. No
host proxy, TUN, DNS, firewall, kill-switch, Controller, or runtime YAML state
was read, changed, or exposed by BR-01.
