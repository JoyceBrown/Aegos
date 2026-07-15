# Aegos 3.5.31

Source-only architecture checkpoint. No installer was produced for this patch.

## Runtime Control

- Moved node-selection stale-connection cleanup into `core_runtime`.
- `main.rs` now calls `CoreController::apply_proxy_selection_with_cleanup()` for user node switching instead of separately applying a proxy and then invoking connection cleanup.
- Preserved existing rollback behavior: local selected-node settings are still reverted if runtime node selection fails.

## Guardrails

- Added runtime unit coverage for the selection-with-cleanup boundary contract.
- Updated backend, release, and core-runtime audits to reject direct stale connection cleanup calls from `main.rs`.
- Kept speed-test semantics, auxiliary outbound-IP group sync, provider healthcheck exposure, UI, and installer behavior unchanged.

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
