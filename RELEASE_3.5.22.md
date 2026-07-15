# Aegos 3.5.22

Source-only architecture checkpoint. No installer was produced for this patch.

## Runtime Control

- Moved controller readiness waiting into `core_runtime::CoreController::wait_until_ready`.
- Moved mihomo process exit/status-check classification into `core_runtime::process_exit_message`.
- Moved readiness and runtime restart timing constants into the runtime boundary.
- Kept `main.rs` responsible for orchestration only; it no longer owns ready-loop magic numbers.

## Guardrails

- Updated backend, core-runtime, and release audits to require runtime-owned readiness behavior.
- Added regression coverage for process-exit classification and readiness constants.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml core_runtime -- --nocapture`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
- `npm run audit:backend`
- `npm run audit:core-runtime`
- `npm run audit:release`
- `npm run audit:speed`
- `npm run audit:security`
- `npm run audit:debt`
- `npm run audit:architecture`
- `npm run smoke:interactions`

## Artifact

- Source-only: no installer hash.
- SHA-256: source-only/no-installer.
