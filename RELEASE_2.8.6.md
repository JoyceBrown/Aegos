# Aegos 2.8.6

Source-only small release.

## Changes

- Added sanitized subscription fixtures for Clash YAML, mixed URI, Base64 mixed URI, and unsupported protocol cases.
- Added Rust regression tests that parse fixtures without real airport tokens.
- Added a fixture audit to prevent accidental token leakage and ensure fixture coverage remains wired.
- Included fixture regression checks in backend and release audits.

## Verification

- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run audit:subscription`
- `npm run audit:subscription-fixtures`
- `npm run audit:backend`
- `npm run audit:release`

## Artifact

Source-only; no installer generated for this small version.
SHA-256: Source-only
