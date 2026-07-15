# Aegos 3.5.23

Source-only architecture checkpoint. No installer was produced for this patch.

## Runtime Control

- Moved mode apply timeout ownership into `core_runtime::apply_mode`.
- Moved user proxy selection timeout ownership into `core_runtime::apply_proxy_selection`.
- Moved hidden outbound-IP group sync timeout ownership into `core_runtime::apply_auxiliary_proxy_selection`.
- Moved stale connection cleanup after node selection into `core_runtime::cleanup_stale_connections_after_selection`.
- Preserved the previous node-switch order: select user group, sync hidden outbound-IP group, then clean stale connections.

## Guardrails

- Updated backend, core-runtime, and release audits to reject old direct `main.rs` controller magic numbers for mode and proxy selection.
- Extended runtime lifecycle regression coverage for the newly named timeout constants.

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
