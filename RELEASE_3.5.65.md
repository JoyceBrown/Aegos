# Aegos 3.5.65

## Core runtime digestion
- Moved recovery candidate planning into `core_runtime`.
- Kept `main.rs` responsible for network delay probing only.
- Made `core_runtime` own recovery group ranking, candidate filtering, group-reference skipping, dedupe, and candidate limit handling.
- Preserved filtering for subscription metadata rows such as traffic, expiry, remaining quota, and legacy mojibake metadata names.
- Added unit coverage for recovery candidate ordering and filtering.
- Added architecture audit coverage so recovery planning cannot drift back into ad-hoc `main.rs` logic.

## Why this matters
- Recovery decisions now have a clearer boundary: runtime policy plans which candidates are worth probing, while the manager executes real network checks.
- This reduces duplicate policy code and keeps recovery behavior testable without touching the network.

## Remaining work
- Profile failover planning still has manager-side execution details.
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
