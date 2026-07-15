# Aegos 3.5.24

Source-only architecture checkpoint. No installer was produced for this patch.

## Runtime Control

- Moved status traffic polling SLA into `core_runtime::status_traffic_snapshot`.
- Moved UI proxy-group snapshot SLA into `core_runtime::ui_proxy_groups_snapshot`.
- Moved UI connections snapshot and home active-connection SLA into runtime-owned helpers.
- Moved diagnostic connections sampling SLA and UI close-connection timeouts into runtime-owned helpers.
- Kept the existing timeout values unchanged; this patch only moves ownership and names the contracts.

## Guardrails

- Updated backend, core-runtime, and release audits to reject old read-side controller timeout literals in `main.rs`.
- Extended runtime lifecycle regression coverage for read-side SLA constants.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
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

- Source-only: no installer hash.
- SHA-256: source-only/no-installer.
