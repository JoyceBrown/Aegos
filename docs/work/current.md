# Current Work Checkpoint

record_kind: checkpoint
execution_authority: none
active_plan: ../../PLANS.md
plan_id: AEGOS-WINDOWS-RELIABILITY
current_task_id: none
latest_change_id: CHANGE-034
latest_change_class: task_adjustment
updated_at: 2026-07-27

This checkpoint records facts. It cannot create a task; `PLANS.md` may
authorize work only while marked active and exclusive.

## Current Decision

CHANGE-029 closed the reopened WR-02 after user acceptance rejected the 3.6.66
result. Manual speed tests now show honest, continuously changing elapsed
feedback before the first real result, and navigation away from Connections
preempts startup prewarm and obsolete connection-row construction.

CHANGE-030 is the user's explicit instruction to synchronize the accepted
3.6.67 source, regression coverage, authority records, and redacted evidence
to the configured GitHub `origin/main`. It authorizes one commit and push only;
it does not authorize a GitHub Release, installer upload, signing, automatic
updates, new product work, live Windows takeover, or changes to FlClash.

CHANGE-031 created the public `v3.6.67` GitHub Release and uploaded the exact
accepted unsigned NSIS installer. Its source and artifact are now historical
delivery evidence.

CHANGE-032 is the user's explicit instruction to repair the current-code
three-angle review findings under WR-03. The allowed scope is truthful
connection presentation, failed-recovery rollback, background status and
diagnostic availability, unreadable active-takeover evidence, rejected-profile
speed-state preservation, and focused lock/dead-code cleanup. Release,
installer, GitHub publication, signing, automatic updates, live takeover, and
changes to FlClash remain excluded.

WR-03 is complete. Its six current-code P1/P2 findings have isolated
behavioral controls and fresh affected-gate evidence in
`docs/work/windows-reliability-wr03.md`. No installer, GitHub publication,
live takeover, or FlClash change was performed.

CHANGE-033 is complete. WR-04 repaired the 3.6.67 UI review findings for
state-truth presentation, unavailable-takeover guidance, persistent-metric
freshness, explicit kill-switch state, node-action discoverability,
navigation/profile accessibility, and redacted UI fixtures. The closed
evidence is recorded in `docs/work/windows-reliability-wr04.md`.

CHANGE-034 is the user's explicit authorization for WR-05: build a fresh
source-bound unsigned `3.6.68` NSIS installer, commit and push the accepted
source/evidence, then create a new GitHub Release with the exact installer
SHA-256. `v3.6.67` remains immutable history. Signing, automatic updates,
live takeover, FlClash, and host-network changes remain excluded.

WR-05 is complete. `v3.6.68` targets source commit
`e4dd999f1d97ff079676f109900facceb7dfc572`; the published GitHub Release
contains `Aegos_3.6.68_x64-setup.exe` (16,335,672 bytes, SHA-256
`839804d895d4c5af77568e2e876407a6b29f17bf33fdd9e771165ea387b7ade4`).
The installer is explicitly unsigned. The v3.6.67 tag and asset remain
unchanged historical evidence.

Signing, automatic updates, feature breadth, new installer/release work, and
live Windows takeover remain outside this task. FlClash and the host network
must not be changed.

## Verified Evidence

- Baseline: clean `main`/`origin/main` at `28e539b`, version `3.6.65`.
- Current candidate version: `3.6.68`; the fresh-target installer is frozen
  for the final source-bound matrix and provenance binding. The rejected
  3.6.66 installer is historical evidence.
- The v2 acceptance runner executes 25 distinct commands and binds each to
  current source/gate inputs, timestamps, Windows/toolchain identity, the
  host-safe boundary, and a hashed local log.
- The current matrix covers 224 Rust tests, 12 product journeys, seven pages
  over 14 window/DPI configurations, 800 nodes/420 navigations, 16 soak
  cycles, and both native WebView2 automatic-speed modes.
- The hidden native probe can coexist with the user's installed Aegos because
  only the `native-measurement` feature omits the product single-instance
  plugin. The product build remains single-instance.
- Acceptance and provenance negative fixtures reject stale or changed input,
  missing/tampered logs, declared zero exits, duplicate/missing commands,
  matrix reduction, missing identity, open P1, changed Mihomo, and tampered
  acceptance/artifact bytes.
- Known-bad speed evidence retained run ID `1` on the attempted second click
  and painted no progressive value before terminal because the completed
  backend run still had a throttled foreground UI queue.
- The repaired 800-node negative control advances run IDs `1 -> 2`, paints
  honest elapsed feedback in `4.9 ms`, advances through `0.0/0.1/0.2 s`
  while the first real result is deliberately held for `269.3 ms`, and paints
  that result `31.3 ms` after its event.
- The 1200-row Connections negative control leaves synchronously in `0.2 ms`,
  paints Home in `5.4 ms`, cancels obsolete rendering after 24 rows, and does
  not append hidden rows after navigation.
- The connection leave/return regression now queues a replacement request
  instead of losing both the obsolete first result and the return visit.
- Browser harness cleanup is fail-closed for performance, UI, and soak runs:
  it terminates only Chrome processes bound to the run's exact temporary
  profile, retries deletion for 15 seconds, observes the root absent for one
  second, and fails the test if residue remains. Focused reruns left zero new
  roots; 244 historical smoke profiles (5,788,681,663 bytes) were removed
  with zero failures while the user's Aegos/Mihomo instance remained running.
- Native enabled/suppressed comparisons pass the new actionable-startup gate:
  the final focused samples painted Nodes in `14.5/1.1 ms` and Connections in
  `33.4/22.2 ms`, synchronous work stayed below `1 ms`, and no
  activation task exceeded `50 ms`.

## Failed Attempts Retained

- Direct `npm.cmd` spawning under Node 24 failed with `EINVAL`; the runner now
  invokes the current `npm-cli.js` through `node.exe` with a fixed argument
  array and no shell.
- The first native probe exited on the user's product single-instance lock;
  the test-only feature was isolated instead of stopping the user application.
- The first release skeleton omitted the four runtime/recovery command names;
  the runtime-regression gate rejected it and the record was corrected.
- A final-matrix native run caught a `60.9 ms` first Nodes frame even though
  synchronous work was `0.7 ms`. Its trace proved settings workspace warmup
  overlapped the navigation, so that low-priority work now defers after recent
  input/navigation and retries later.
- Suppressed-speed native samples then exposed hidden-WebView2 frame
  throttling at `54.2-55.7 ms` with no long task. The isolated harness now
  measures a visible-compositor window fixed offscreen, unfocused, and absent
  from the taskbar; the `50 ms` product gate was not widened.
- During CHANGE-030 synchronization validation, the just-shown offscreen
  window acknowledged a single `requestAnimationFrame` before a physically
  actionable presented frame. The next simulated Nodes input measured
  `56.3 ms` despite `0.7 ms` synchronous work and no activation-window long
  task. The native probe now requires three compositor frames before modelling
  physical input; it retains all pages, fixed window/DPI configurations,
  startup overlap, and the `50 ms` navigation limit. The focused enabled-mode
  repair sample then measured Nodes at `26.8 ms` and Connections at `33.7 ms`.
- The first 3.6.65 installer retained a `v3.6.63` sidebar fallback label; the
  release gate rejected it. The label was corrected and the installer was
  rebuilt from an empty `candidate-3.6.65-final` target before acceptance.

## Exact Next Action

WR-05 is closed. Wait for a new explicit user instruction; do not modify host
networking or FlClash.
