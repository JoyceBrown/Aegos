# Current Work Checkpoint

record_kind: checkpoint
execution_authority: none
active_plan: ../../PLANS.md
plan_id: AEGOS-WINDOWS-RELIABILITY
current_task_id: none
latest_change_id: CHANGE-027
latest_change_class: task_adjustment
updated_at: 2026-07-27

This checkpoint records facts. It cannot create a task; `PLANS.md` may
authorize work only while marked active and exclusive.

## Current Decision

WR-01 and CHANGE-027 are complete. The six-item closure produced executable
evidence, a current host-safe matrix, aligned authority records, one fresh
source-bound unsigned installer, and an authorized Git completion baseline.
There is no active WR-02 because no qualifying user-visible P0/P1 remains.

Signing, GitHub Release publication, automatic updates, feature breadth, and
live Windows takeover remain outside the completed task. FlClash and the host
network were not changed.

## Verified Evidence

- Candidate version: `3.6.65`.
- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.65_x64-setup.exe`.
- Installer size: `16,325,000` bytes.
- Installer SHA-256:
  `93d5691de31c5fe436b596c2075a5e0f62697464d998f5ec8a51b23fef462323`.
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

## Failed Attempts Retained

- Direct `npm.cmd` spawning under Node 24 failed with `EINVAL`; the runner now
  invokes the current `npm-cli.js` through `node.exe` with a fixed argument
  array and no shell.
- The first native probe exited on the user's product single-instance lock;
  the test-only feature was isolated instead of stopping the user application.
- The first release skeleton omitted the four runtime/recovery command names;
  the runtime-regression gate rejected it and the record was corrected.
- The first 3.6.65 installer retained a `v3.6.63` sidebar fallback label; the
  release gate rejected it. The label was corrected and the installer was
  rebuilt from an empty `candidate-3.6.65-final` target before acceptance.

## Delivery State

The source completion commit must contain the cumulative preserved worktree
and be pushed to the configured `origin`. This external state is verified and
reported by Git rather than predicted in this checkpoint. If that commit is
already present on `origin/main`, wait for a new explicit user-visible
priority; otherwise finish only the authorized commit/push delivery step.

## Exact Next Action

With the completion commit present on `origin/main`, wait. Do not activate
WR-02, signing, a GitHub Release, automatic updates, feature work, or live
takeover without a new explicit user instruction.
