# Windows Reliability WR-11 Evidence

record_kind: evidence_register
execution_authority: none
plan_id: AEGOS-WINDOWS-RELIABILITY
task_id: WR-11
change_id: CHANGE-042
evidence_state: closed
version: 3.6.70
git_baseline: 941d1f6fc591a0c89709948a42e4e6a6cbcf5564
utc_interval: 2026-07-27T21:34:00Z/2026-07-27T22:10:16Z

## Scope And Boundary

WR-11 changes only the first Nodes/Connections prewarm scheduler. Every queued
prewarm animation frame is tracked and cancelled synchronously by a user page
request, in addition to the existing generation checks. It keeps foreground
page loading and navigation behavior unchanged.

The unchanged complete product journey exposed one pre-existing terminal UI
defect: a failed observed stop operation could leave the derived connection
button at its temporary status-center action when the restored runtime snapshot
equalled the prior snapshot. `renderStatus` now updates that derived connection
button before its unchanged-snapshot return. This is presentation-only; no job,
core, network, or retry behavior changed.

No core lock change, write-operation change, network mutation, installer,
release, commit, push, GitHub action, FlClash action, or host proxy, TUN, DNS,
firewall, or kill-switch action was performed.

## Preserved Failure Controls

`node tools/interaction-smoke.js --r3-known-bad` disables only prewarm
cancellation for an already queued hidden Nodes frame, then requests
Connections. It exits nonzero with `expectedFailure: true`, `rejected: true`,
and `stalePrewarmAfterNavigation: true` (`node-page-prewarmed`). It proves the
old frame could render obsolete hidden work after the user click.

The full product journey also retained the prior observed-stop failure
assertion. Before this repair it failed three consecutive R3 runs because the
terminal button remained the status-center action. The cause was the unchanged
snapshot short circuit described above, not a timing relaxation.

## Repaired Behavioral Evidence

`node tools/interaction-smoke.js --r3-repaired` exited 0 with
`stalePrewarmAfterNavigation: false` and an empty stale-kind list. The click
cancels the queued callback before it can add a prewarm class, render Nodes, or
write a prewarm timing event.

`npm run smoke:interactions` exited 0 at 2026-07-27T22:06:55Z: 13 product
journeys passed, all required commands and job kinds were present, forbidden
speed, standby-core, and status-center side effects were zero, and test-root
cleanup left no residue. It exercises a delayed observed stop failure and
proves the derived connection button returns to its true retry action.

## Regression Matrix

All commands below exited 0 on the dirty source baseline above. Existing
fixtures and thresholds were unchanged: 14 fixed window/DPI configurations,
800 nodes and 420 navigation changes, 16 soak cycles, and both native modes.

- `npm run smoke:ui`: 14 fixed window/DPI configurations, no text or geometry
  failures.
- `npm run smoke:perf:stress`: 800 nodes, 420 navigations, p95 navigation
  `0.2 ms`, repeated speed feedback `2.9 ms`, and no active-page failure.
- `npm run smoke:soak`: 16 cycles, no failures, stuck testing, timer growth,
  or residual test roots.
- `npm run smoke:perf:native`: isolated native WebView2 automatic-speed
  enabled; cold Nodes/Connections first frames `14.0/34.1 ms` with no startup
  long task. A broader navigation sample warning (`70.6 ms`) is retained as a
  warning and was not used to claim a global sub-50ms result.
- `node tools/native-perf-smoke.js --automatic-speed=suppressed`: isolated
  suppressed mode; cold Nodes/Connections first frames `17.3/34.4 ms`.
- `npm run audit:responsiveness`, `npm run audit:security`,
  `npm run audit:control-plane`, `npm run audit:architecture`, and
  `npm run audit:planning-context`.

The worktree was intentionally dirty before WR-11 and retained user-owned
3.6.69/3.6.70 candidate, UI, performance, release-record, and planning work.
WR-11 adds only the tracked prewarm-frame cancellation, the deterministic
fixture, the derived connection-button correction, and this evidence record.

## Result

The scoped R3 first-navigation path has no open P1. WR-12 is a separately
authorized R4 task; this register authorizes neither delivery nor network
action.
