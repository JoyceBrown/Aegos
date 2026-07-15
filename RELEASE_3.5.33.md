# Aegos 3.5.33

Source-only architecture checkpoint. No installer was produced for this patch.

## Runtime Control

- Moved the running-core guard for auxiliary proxy selection into `core_runtime`.
- `main.rs` still owns the Aegos product rule for choosing the hidden outbound-IP group target, while `CoreController` owns whether that controller mutation is allowed when the dataplane is running.
- Preserved existing behavior: stopped core does not try to sync the hidden outbound-IP group, and running-core failures are logged without breaking node switching.

## Guardrails

- Added runtime unit coverage for stopped/running auxiliary proxy selection guard behavior.
- Updated backend, release, and core-runtime audits to reject direct hidden-group auxiliary selection calls from `main.rs`.
- Kept speed-test semantics, mode application, node selection cleanup, provider healthcheck exposure, UI, and installer behavior unchanged.

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
