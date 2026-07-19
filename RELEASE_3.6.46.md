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

## Verification

- Rust unit suite, command/controller/configuration/takeover/routing audits,
  UI syntax validation, and release gate are required for this release.
- Aegos was not launched during verification; no proxy, TUN, firewall, or
  FlClash-controlled network state was changed.

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.46_x64-setup.exe`
- SHA-256: `72d604890a132e3c83e68951c83aa6c00f86102d4f43b8f8127a453ab09675b6`
