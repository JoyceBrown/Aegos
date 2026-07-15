# Aegos 3.5.43

Source-only architecture checkpoint. No installer was produced for this patch.

## Diagnostics Runtime

- No UI behavior changed.
- No diagnostic workflow behavior changed.
- Added `diagnostics_runtime` as the shared log export shaping boundary.
- Moved log entry/store typing and log export document/category shaping out of `main.rs`.
- Kept `main.rs` responsible for snapshotting logs, choosing the export path, and writing with the existing path-confined atomic writer.

## Guardrails

- Updated diagnostics, diagnostics-product, backend, release, and security audits to check the new diagnostics boundary.
- Added unit coverage for log export category counting and sanitization.
- Removed a brittle diagnostics-product audit dependency on historical mojibake UI text.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture` (78 tests passed)
- `npm run audit:release`
- `npm run audit:backend`
- `npm run audit:architecture`
- `npm run audit:debt`
- `npm run audit:security`
- `npm run audit:speed`
- `npm run audit:core-runtime`
- `npm run audit:stability`
- `npm run audit:diagnostics`
- `npm run audit:diagnostics-product`
- `npm run smoke:interactions`
- `git diff --check`

## Artifact

- Source-only: no installer hash.
- SHA-256: source-only/no-installer.
