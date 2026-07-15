# Aegos 3.5.43

Installer candidate for the diagnostics-runtime architecture checkpoint.

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

- `npm run build`
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
- `npm run audit:installer`
- `npm run smoke:interactions`
- `git diff --check`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.5.43_x64-setup.exe`
- SHA-256: `0feefe04cf1e0fa2888efc7b81b10701169f18ace09b6072ba7d6adaaeb94d71`
