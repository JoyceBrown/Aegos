# Aegos 3.5.29

Source-only architecture checkpoint. No installer was produced for this patch.

## Runtime Control

- Moved status traffic idle/fallback shaping into `core_runtime`.
- `main.rs` now asks `CoreController` for the status traffic snapshot contract instead of keeping a local `traffic_snapshot` wrapper and idle JSON branch.
- Preserved the existing status heartbeat behavior: stopped core reports zero traffic, running core uses the short `/traffic` status timeout, and transient read failures keep the last traffic snapshot.

## Guardrails

- Added runtime unit coverage for stopped-core idle traffic and running-core fallback behavior.
- Updated backend, release, and core-runtime audits so future changes cannot reintroduce local status traffic shaping in `main.rs`.
- Kept speed-test, provider healthcheck, UI, and installer behavior unchanged.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
- `npm run audit:backend`
- `npm run audit:core-runtime`
- `npm run audit:release`
- `npm run audit:architecture`
- `npm run audit:connection-closure`
- `npm run audit:security`
- `npm run audit:speed`
- `npm run audit:debt`
- `npm run audit:provider-healthcheck`
- `npm run audit:routing-readonly`
- `npm run smoke:interactions`
- `git diff --check`

## Artifact

- Source-only: no installer hash.
- SHA-256: source-only/no-installer.
