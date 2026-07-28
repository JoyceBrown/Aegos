# Windows Reliability WR-12 Evidence

record_kind: evidence_register
execution_authority: none
plan_id: AEGOS-WINDOWS-RELIABILITY
task_id: WR-12
change_id: CHANGE-043
evidence_state: closed
version: 3.6.70
git_baseline: 941d1f6fc591a0c89709948a42e4e6a6cbcf5564
utc_interval: 2026-07-27T22:12:20Z/2026-07-27T22:20:08Z

## Scope And Boundary

WR-12 changes only frontend elapsed-speed feedback presentation. The initiating
manual test click still paints its first honest numeric value synchronously.
Later 80ms timer ticks request one animation frame, write only after the
displayed tenth-second value changes, and query pending cells only inside the
active page. Existing result events remain frame-coalesced and preserve their
complete overlay for later node-page rendering.

No measurement endpoint, speed-test target, selection, connection, core lock,
network mutation, installer, release, commit, push, GitHub action, FlClash
action, or host proxy, TUN, DNS, firewall, or kill-switch action changed.

## Preserved Failure Control

`node tools/perf-smoke.js --stress --r4-known-bad` enables only a test-only
historical global pending-cell scan in the same 800-node fixture. It exits
nonzero with `expectedFailure: true`, `rejected: true`, and
`hiddenPendingCellWasWritten: true`: a pending probe appended to an inactive
Profiles page changes from `hidden-speed-probe` to `等待 0.1s`. The same run
retains immediate feedback (`3.7 ms`) and three pre-result values, proving the
rejection is specifically the hidden DOM write rather than a disabled test.

## Repaired Behavioral Evidence

`node tools/perf-smoke.js --stress --r4-repaired` exited 0 with
`hiddenPendingCellWasWritten: false`, first feedback `2.7 ms`, and the
unchanged pre-result sequence `等待 0.0s`, `等待 0.1s`, `等待 0.2s`. It proves
the repair is frame-coalesced, maintains instant measurement response, and
does not update a hidden pending cell.

## Regression Matrix

All commands below exited 0 on the dirty source baseline above. Matrix floors
were not reduced: 14 fixed window/DPI configurations, 800 nodes and 420
navigations, 16 soak cycles, and both isolated native modes.

- `npm run smoke:interactions`: 13 product journeys, 264 commands, all required
  job kinds, zero forbidden speed/standby/status-center side effects, and no
  residual test root.
- `npm run smoke:ui`: all 14 fixed window/DPI configurations with no text or
  geometry failure.
- `npm run smoke:perf:stress`: 800 nodes and 420 navigations; p95 navigation
  `0.2 ms`, immediate repeated-speed feedback `4.3 ms`, real-result paint lag
  `30.5 ms`, and the hidden probe unchanged.
- `npm run smoke:soak`: 16 cycles with no failures, stuck testing, timer
  growth, or residual test roots.
- `npm run smoke:perf:native`: isolated native WebView2 automatic-speed
  enabled, exited 0; cold Nodes/Connections first frames `17.1/33.0 ms`.
- `node tools/native-perf-smoke.js --automatic-speed=suppressed`: isolated
  native suppressed mode, exited 0; no automatic measurement started.
- `npm run audit:responsiveness`, `npm run audit:security`,
  `npm run audit:control-plane`, `npm run audit:architecture`, and
  `npm run audit:planning-context`.

The worktree was intentionally dirty before WR-12 and retained user-owned
3.6.69/3.6.70 candidate, UI, performance, release-record, and planning work.
WR-12 adds only the elapsed-feedback frame coalescing, deterministic 800-node
fixture controls, current authority records, and this evidence register.

## Result

The scoped R4 speed-result presentation path has no open P1. The plan is
complete and grants no delivery or network authority.
