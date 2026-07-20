# Aegos 3.6.46

## Control-plane maturity release

- Added a typed runtime-command coordinator with an observable active-operation
  snapshot. The status center now reports the operation currently changing
  runtime state instead of inferring it from unrelated background jobs.
- Hardened system takeover recovery: unreadable journals surface as recovery
  incidents, active takeover state is durably tracked, and Windows journal
  replacement uses write-through replacement semantics.
- Reworked user routing and strategy validation into Aegos semantic objects:
  website/process/country/IP conditions, direct/reject/named targets, typed
  options, and strategy policies compile deterministically to Mihomo syntax.
- Included rule-store undo evidence in the deployment transaction; failed undo
  persistence or finalization now rolls back both the store and runtime state.
- Added explicit Mihomo capability/identity admission checks and documented
  version governance plus the boundary for upstream collaboration.
- Tuned streamed speed-result rendering with a bounded 48-item frame batch,
  a 0.75ms processing budget, shell-free progress updates, and throttled
  visible-row updates while preserving terminal reconciliation. Batch events no
  longer populate the single-node result cache, and active foreground input
  defers background result DOM work until the quiet window.

## Verification

- Rust unit suite, command/controller/configuration/takeover/routing audits,
  UI syntax validation, and release gate are required for this release.
- Rust suite (173 tests), soak smoke (300 commands), installer audit, release
  audit, speed-closure audit, and speed-reform audit passed. The repeated
  performance gate still reports an intermittent speed-stream frame-pacing
  failure on this host; thresholds were not weakened and no passing evidence
  was fabricated.
- The reproducible host limitation and reopening criteria are recorded in
  `PERFORMANCE_LIMITATION_3.6.46.md`.
- Aegos was not launched during verification; no proxy, TUN, firewall, or
  FlClash-controlled network state was changed.

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.46_x64-setup.exe`
- SHA-256: `36df3e9b9717509dcc7a953841f3088195f4a3aa0548cd7cc5130cbde0cd97b1`
