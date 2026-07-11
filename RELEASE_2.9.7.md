# Aegos 2.9.7

Source-only small release.

## Changes

- Strengthened the soak smoke test to cover failed single-node speed tests.
- Verified failed node tests trigger node-level diagnostics capture.
- Added release audit coverage for the soak smoke script and node diagnostics coverage.
- Kept this version focused on stability validation without changing runtime behavior.

## Verification

- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run smoke:interactions`
- `npm run smoke:soak`

## Artifact

Source-only; no installer generated for this small version.
SHA-256: Source-only
