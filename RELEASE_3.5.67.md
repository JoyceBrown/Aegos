# Aegos 3.5.67

## Core runtime digestion
- Unified profile mutation rollback startup through `CoreRuntimeRestartPlan`.
- Kept `main.rs` responsible for executing stop/start and file/settings rollback.
- Removed scattered profile switch/import/update/remove restart branches that manually chose between connected and standby startup.
- Added runtime coverage for preserving standby state during mutation rollback.
- Added architecture audit coverage so profile mutation rollback keeps using the shared restart plan.

## Why this matters
- Subscription changes now use one restart intent model for both connected and standby core states.
- This reduces the chance that a failed import or update accidentally reconnects traffic when the user was only in standby.

## Remaining work
- System proxy registry writes and disconnect-protection firewall script execution still remain manager-side execution details.
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
