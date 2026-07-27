# Aegos Windows Real-Use Reliability Roadmap

roadmap_id: AEGOS-WINDOWS-RELIABILITY
execution_authority: none
updated_at: 2026-07-27

This document owns long-term order and rationale only. It cannot authorize
code changes. `PLANS.md` is the only plan record that may become executable;
its current metadata determines whether a task is active.

## Mainline Outcome

Make Aegos a dependable Windows control plane in daily use: importing,
choosing, connecting, observing, switching, disconnecting, diagnosing, and
recovering must have truthful effective state and must not freeze the usable
application.

The target is not feature parity with broad proxy clients. Aegos already has a
substantial capability baseline. The remaining product risk is whether that
baseline stays correct and recoverable through slow, failed, interrupted, and
real Windows operations.

## Completed Foundation

The completed Windows Maturity program (WM-01 through WM-05) established
isolated managed-core, native WebView2, large-list, rollback, and full-gate
evidence. Its records are historical evidence, not an active direction:

- `docs/work/windows-maturity-wm01.md` through
  `docs/work/windows-maturity-wm05.md`
- `RELEASE_3.6.58.md` through `RELEASE_3.6.62.md`
- `docs/decisions/windows-maturity-mainline.md`

It did not prove shared-host system-proxy, TUN, DNS interception, firewall, or
external-connectivity takeover. That limitation is the reason the next route
starts with real-use defect evidence rather than declaring the product finished.

## Ordered Direction

| Order | Outcome | Dependency | What it prevents |
| --- | --- | --- | --- |
| 1 | Reproduce and classify real-use defects, including UI freezes, stuck operations, stale state, and recovery gaps. | Existing 3.6.62 baseline. | Guess-driven rewrites and feature detours. |
| 2 | Repair every reproduced P0/P1 in its owning transaction and preserve the regression. | A precise evidence-register entry. | Repeating the same visible failure. |
| 3 | Prove real Windows takeover and recovery only in a dedicated, recoverable lab. | Explicit recovery procedure and separate environment; never the shared FlClash host. | Uncontrolled host-network changes. |
| 4 | Reduce a specific orchestration hotspot only when a reproduced fault or trace proves its ownership. | A focused failing path and regression. | Architecture-only rewrites and dual paths. |

The completed WR-01 and CHANGE-029 WR-02 work covered and closed the first two outcomes
for the host-safe evidence boundary. The later outcomes are not task backlogs
and do not begin automatically.

## Priority Rules

- A reproduced P0/P1 in the existing Windows journey is fixed before lower
  priority polish or a new capability.
- A UI freeze, blocked navigation, permanent pending indicator, stale success
  claim, or unrecoverable rollback is a reliability defect in the current
  route, not a separate UX project.
- Isolated tests, mocks, and scans are evidence layers. They never imply a
  live Windows fact that they did not observe.
- `main.rs`, `core_runtime.rs`, and `app.js` may be changed only through a
  focused owner extraction required by the defect. The replacement path must
  be removed and the no-growth budgets must pass.

## Not Planned

The following items are deliberately absent from this roadmap. They require a
future user decision and a new route; they cannot be revived by a bare
"continue":

- signing, GitHub publishing automation, automatic updates, or updater work;
- WebDAV, cloud backup, synchronization, remote control, or remote execution;
- Windows ARM64, macOS, Linux, or a cross-platform abstraction;
- a second core, raw Mihomo Controller/runtime-YAML UI, arbitrary scripts, or
  protocol and rules-engine implementation;
- a broad UI redesign or frontend framework migration.

## Decision Owner

The analysis, competitor comparison, and route rationale are maintained in
`docs/decisions/windows-reliability-mainline.md`.
