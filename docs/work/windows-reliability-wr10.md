# Windows Reliability WR-10 Evidence

record_kind: evidence_register
execution_authority: none
plan_id: AEGOS-WINDOWS-RELIABILITY
task_id: WR-10
change_id: CHANGE-041
evidence_state: closed
version: 3.6.70
git_baseline: 941d1f6fc591a0c89709948a42e4e6a6cbcf5564
utc_interval: 2026-07-27T21:20:00Z/2026-07-27T21:33:38Z

## Scope And Boundary

WR-10 changes only read-side display snapshots. Nodes and Rules return a full
successful snapshot for the matching active profile or an explicit loading
object when no matching snapshot exists. Diagnostics returns a complete cached
report or explicit loading while its existing background-job and write
semantics remain unchanged. Cached observations are labelled non-current.

No CoreManager lock replacement, new concurrency framework, global timeout,
write-operation change, installer, release, commit, push, GitHub action,
FlClash action, or host proxy, TUN, DNS, firewall, or kill-switch action was
performed.

## Preserved Failure Control

`node tools/interaction-smoke.js --r2-known-bad` enables an isolated old
frontend branch only at the cached Nodes response. It records
`expectedFailure: true`, `rejected: true`, and `nodeSnapshotDiscarded: true`:
the historical array-only handler discards the wrapped cached snapshot and
clears the visible node group. The command exits nonzero as required for the
known-bad control. The rest of the product journey remains on repaired logic,
so this failure is attributable solely to the old display-read behavior.

## Repaired Behavioral Evidence

The Rust controls passed on the current dirty baseline:

- `cargo test --manifest-path src-tauri/Cargo.toml display_cache -- --nocapture`:
  2 passed. It proves profile-matching cache reuse, mismatched-profile loading,
  and deterministic `WouldBlock` lock contention fallback.
- `cargo test --manifest-path src-tauri/Cargo.toml diagnostics_cache_returns_a_complete_report_or_explicit_loading -- --nocapture`:
  1 passed. It proves diagnostics returns a full cached report or explicit
  loading with no partial report presented as current.
- `cargo check --manifest-path src-tauri/Cargo.toml`, `node --check src/app.js`,
  and `node --check tools/interaction-smoke.js`: exited 0.

`npm run smoke:interactions` exited 0 with all existing product journeys,
including diagnostics, and with zero forbidden speed, standby-core, or
status-center backend side effects. The repaired cache assertions retain the
known Nodes group for cached and cold-loading reads, label a cached Nodes or
Rules response as a prior observation, and keep loading clear instead of
claiming a fresh fact.

## Regression Matrix

All commands below exited 0 without reducing the existing fixtures, windows,
DPI configurations, node count, navigation count, or soak cycles:

- `npm run smoke:ui`: all 14 fixed window/DPI configurations, no text overflow
  or geometry collision.
- `npm run smoke:perf:stress`: 800 nodes and 420 navigation changes; p95
  navigation `0.3 ms`, immediate numeric speed feedback `2.6 ms`.
- `npm run smoke:soak`: 16 cycles, no failures, stuck testing, timer growth,
  or residual test roots.
- `npm run smoke:perf:native`: isolated native WebView2, automatic speed
  enabled, exited 0.
- `node tools/native-perf-smoke.js --automatic-speed=suppressed`: isolated
  native WebView2 suppressed mode, exited 0.
- `npm run audit:responsiveness`, `npm run audit:security`,
  `npm run audit:control-plane`, `npm run audit:architecture`, and
  `npm run audit:planning-context`.

The worktree was intentionally dirty before WR-10, containing user-owned
3.6.69/3.6.70 candidate, UI, performance, release-record, and planning
changes. WR-10 adds only the read-side cache presentation, deterministic
fixtures, current authority records, and this evidence register; it preserves
all unrelated changes.

## Result

The scoped R2 display-read path has no open P1. Future work requires explicit
user authority; this register authorizes neither delivery nor network action.
