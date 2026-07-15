# Aegos 3.5.27

Source-only architecture checkpoint. No installer was produced for this patch.

## Runtime Control

- Moved the running-state proxy-group snapshot fallback into `core_runtime`.
- Added `CoreController::ui_proxy_groups_snapshot_or_none` so `main.rs` no longer owns the "only read controller while running" proxy-group rule.
- Deleted the old `controller_proxy_groups_snapshot` helper from `main.rs`.

## Guardrails

- Updated backend, core-runtime, and release audits to reject the old `main.rs` proxy-group wrapper and require the runtime helper.
- Updated security audit slicing after the deleted helper so log export redaction remains checked against the correct source range.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
- `npm run audit:backend`
- `npm run audit:core-runtime`
- `npm run audit:release`
- `npm run audit:security`
- `npm run audit:speed`
- `npm run audit:debt`
- `npm run audit:architecture`
- `npm run audit:provider-healthcheck`
- `npm run audit:routing-readonly`
- `npm run smoke:interactions`
- `git diff --check`

## Artifact

- Source-only: no installer hash.
- SHA-256: source-only/no-installer.
