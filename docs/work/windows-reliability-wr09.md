# Windows Reliability WR-09 Evidence

record_kind: evidence_register
execution_authority: none
plan_id: AEGOS-WINDOWS-RELIABILITY
task_id: WR-09
change_id: CHANGE-040
evidence_state: closed
version: 3.6.70
git_baseline: 941d1f6fc591a0c89709948a42e4e6a6cbcf5564
utc_interval: 2026-07-27T20:31:00Z/2026-07-27T20:37:33Z

## Scope And Boundary

WR-09 repairs only the initiating controls for long-running `startCore` and
`stopCore` jobs. After a 1200 ms observation window, a non-terminal job retains
the same Job ID in the status center and the initiating button becomes the
truthful recovery action `查看连接任务`. The action does not start another job.
The status center remains the existing source for cooperative cancellation on
jobs whose backend snapshot marks them cancellable.

This is not a global job timeout, a forced process termination path, or a
network-operation rewrite. No installer, release, commit, push, GitHub action,
FlClash action, host proxy/TUN/DNS/firewall action, or other host-network
mutation was performed.

## Preserved Failure Control

`node tools/interaction-smoke.js --r1-known-bad` disables only the foreground
observation handoff in the isolated browser fixture. Its held `startCore` job
remains non-terminal for 1320 ms. The fixture records that the initiating
button is still `data-busy=true` and exits nonzero as the expected rejection.
This is the pre-repair control: the user has neither a released control nor a
useful recovery action while the same backend job is still running.

## Repaired Behavioral Evidence

`npm run smoke:interactions` exited 0 after the repair. Its controlled job
sequence proves all of the following without changing real networking:

- a held `startCore` job releases its initiating button after the observation
  window, exposes `查看连接任务`, opens the status center, retains the same
  `startCore` row, and does not issue another `start_job` call;
- when that observed job later succeeds, the status refreshes to `已连接` and
  the action returns to `断开连接`;
- a held `stopCore` job receives the same observation handoff, then a simulated
  terminal failure restores the truthful connected state and `断开连接` retry
  action while retaining the failure message in the status center;
- the existing cancellable `updateAllProfiles` path remains cooperative: the
  UI requests cancellation, then verifies the backend-reported `cancelled`
  terminal state rather than declaring it locally.

`cargo test --manifest-path src-tauri/Cargo.toml task_runtime::tests --
--nocapture` exited 0: 3 passed, 0 failed, 226 filtered. It covers rejection of
non-cancellable cancellation, a cancellable job that remains `cancelled` after
the worker returns, and a panicking worker that becomes `failed` rather than
remaining running.

## Regression Matrix

The following commands exited 0 on the current dirty source baseline above:

- `node --check src/app.js`
- `node --check tools/interaction-smoke.js`
- `npm run smoke:interactions`
- `npm run smoke:ui` (all existing 14 fixed window/DPI configurations; no text
  overflow, geometry collision, or status-center row wrapping)
- `npm run smoke:soak` (16 cycles; no failures, stuck testing, or timer growth)
- `npm run audit:responsiveness`
- `npm run audit:security`
- `npm run audit:control-plane`
- `npm run audit:architecture`
- `npm run audit:planning-context`

The dirty worktree also contains the user's prior 3.6.69/3.6.70 candidate,
layout, performance, and release-record changes. WR-09 intentionally changes
only `src/app.js`, `tools/interaction-smoke.js`, the planning/checkpoint
records, and this evidence register; it neither reverts nor claims ownership
of the unrelated dirty files.

## Result

All required R1 acceptance paths are closed. No P1 remains open in the scoped
long-running core-operation recovery path. The next action is to wait for an
explicit user instruction; no delivery operation is authorized by this record.
