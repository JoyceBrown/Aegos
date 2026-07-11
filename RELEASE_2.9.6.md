# Aegos 2.9.6

Source-only small release.

## Changes

- Added read-only node-level diagnostics for health, recent matching logs, failure classification, and same-region suggestions.
- Linked failed single-node speed tests to lightweight diagnostics capture without blocking the button or changing node selection.
- Added interaction smoke support for node diagnostics.
- Added backend and release audit coverage for node diagnostics.

## Verification

- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run smoke:interactions`

## Artifact

Source-only; no installer generated for this small version.
SHA-256: Source-only
