# Aegos 3.5.21

Source-only checkpoint.

## Runtime Lifecycle Boundary

- Moved runtime lifecycle messages and formatting helpers into `core_runtime`.
- Replaced direct lifecycle string ownership in `main.rs` with runtime-owned constants/functions for:
  - failed startup cleanup
  - normal stop
  - app-exit stop
  - controller ready timeout
  - standby speed-test startup
  - runtime drift restart
  - core missing errors
  - core exited/status-check failures
  - hot reload success logging

## Audit Guardrails

- Updated backend, release, speed, architecture, and core-runtime audits so lifecycle contracts must stay under `core_runtime`.
- Added runtime unit coverage for lifecycle messages and hot reload log formatting.
- Kept behavior and existing user-facing/log strings stable; this checkpoint changes ownership, not product flow.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml core_runtime -- --nocapture`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
- `npm run check`
- `npm run audit:backend`
- `npm run audit:core-runtime`
- `npm run audit:release`
- `npm run audit:speed`
- `npm run audit:security`
- `npm run audit:debt`
- `npm run audit:architecture`
- `npm run smoke:interactions`
- `git diff --check`

## Artifact

- No installer was produced for this source-only checkpoint.
- SHA-256: source-only/no-installer.
