# Aegos 3.5.62

## Core runtime digestion
- Moved reliability recovery probe and result shaping into `core_runtime`.
- Kept `main.rs` responsible for executing recovery probes, node switches, and profile failover, while `core_runtime` now owns the public recovery result contract:
  - healthy/no-action result
  - observe-before-threshold result
  - proxy-switched result
  - profile-switched result
  - final failed result
  - probe status/result payload
- Added unit coverage for all recovery result branches.
- Added architecture audit coverage so recovery actions and `profileChanged` semantics cannot drift back into ad-hoc `main.rs` JSON.

## Why this matters
- Recovery is now more Aegos-owned: the UI and job layer depend on an Aegos recovery contract instead of direct mihomo-adjacent implementation details.
- Later recovery engines can change how probes or failover execute without changing the front-end result shape.

## Remaining work
- Recovery execution still probes through the current runtime controller and proxy path.
- Candidate selection and profile failover planning still live in `main.rs`; later checkpoints should move the planning policy into typed runtime APIs.

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
- Source-only checkpoint. SHA-256: source-only.
- No installer was produced for this version.
