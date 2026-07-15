# Aegos 3.5.66

## Core runtime digestion
- Moved recovery profile failover planning into `core_runtime`.
- Kept `main.rs` responsible for executing profile switches, hot reloads, and recovery probes.
- Made `core_runtime` own failover candidate filtering: skip current profile, `direct`, builtin profiles, empty ids, and duplicate ids.
- Added unit coverage for failover candidate ordering and filtering.
- Added architecture audit coverage so recovery failover filtering cannot drift back into ad-hoc `main.rs` loops.

## Why this matters
- Recovery now has a cleaner split between policy and execution: runtime decides which backup profiles are valid candidates, while the manager performs real mutations and rollback.
- This makes future reliability work easier to test without touching Windows proxy state or core process state.

## Remaining work
- Recovery rollback planning still lives partly in manager execution flow.
- Routing apply/undo result shaping and rollback planning still need deeper runtime/config boundary cleanup.

## Verification
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `npm run audit:core-runtime`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run audit:security`
- `npm run audit:speed`
- `npm run audit:stability`
- `npm run audit:architecture`
- `npm run audit:debt`
- `npm run audit:takeover`
- `npm run smoke:interactions`
- `git diff --check`

## Artifact
- Source-only checkpoint. Installer was not built for this version.
- SHA-256: N/A for source-only checkpoint.
