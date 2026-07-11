# Aegos 2.8.4

Source-only small release.

## Changes

- Added shared subscription text normalization before YAML/URI parsing.
- Ignored common airport metadata, comments, and blank lines in URI subscriptions.
- Accepted Base64-wrapped mixed URI subscriptions through the diagnostic parser.
- Accepted BOM-prefixed Clash YAML subscriptions.
- Expanded subscription diagnostics audit coverage for these compatibility cases.

## Verification

- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run audit:subscription`
- `npm run audit:backend`
- `npm run audit:release`

## Artifact

Source-only; no installer generated for this small version.
SHA-256: Source-only
