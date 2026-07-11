# Aegos 2.8.3

Source-only small release.

## Changes

- Added structured subscription failure diagnostics for import/update.
- Classified invalid URL, download/client failure, HTTP status, empty content, YAML parse failure, unsupported format, unsupported URI protocol, and runtime preflight failure.
- Routed detached subscription import/update through the diagnostic downloader.
- Added unit tests and a dedicated subscription diagnostics audit.

## Verification

- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run audit:subscription`
- `npm run audit:backend`
- `npm run audit:release`

## Artifact

Source-only; no installer generated for this small version.
SHA-256: Source-only
