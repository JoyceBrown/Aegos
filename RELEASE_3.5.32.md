# Aegos 3.5.32

Source-only architecture checkpoint. No installer was produced for this patch.

## Runtime Control

- Moved the running-core guard for mode application into `core_runtime`.
- `main.rs` now saves the requested mode, then asks `CoreController::apply_mode_if_running()` to apply it only when the dataplane is active.
- Preserved existing best-effort behavior: mode save remains successful even if the stopped core has nothing to patch.

## Guardrails

- Added runtime unit coverage for stopped/running mode-apply guard behavior.
- Updated backend, release, and core-runtime audits to reject direct mode application from `main.rs`.
- Kept speed-test semantics, node selection cleanup, provider healthcheck exposure, UI, and installer behavior unchanged.

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
