# Aegos 3.5.30

Source-only architecture checkpoint. No installer was produced for this patch.

## Runtime Control

- Moved runtime reuse readiness probing into `core_runtime`.
- `main.rs` now asks `CoreController::runtime_reuse_ready()` instead of knowing the `/version` reuse-probe timeout contract.
- Preserved existing behavior for unchanged runtime reuse during start, profile hot reload, and speed-test controller preparation.

## Guardrails

- Added runtime unit coverage for the reuse readiness probe contract.
- Updated backend, release, and core-runtime audits to reject `READY_REUSE_PROBE_TIMEOUT_MS` usage from `main.rs`.
- Kept speed-test semantics, provider healthcheck exposure, UI, and installer behavior unchanged.

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
