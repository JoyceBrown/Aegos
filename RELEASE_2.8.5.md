# Aegos 2.8.5

Source-only small release.

## Changes

- Added an explicit protocol capability matrix for Aegos URI parsing and bundled Mihomo proxy types.
- Runtime config preflight now rejects core-unsupported proxy types before writing or switching subscriptions.
- Preflight success reports include protocol capability metadata.
- Manual fixed-node protocol input now normalizes aliases such as `hy2` to `hysteria2`.
- Expanded backend and release audits for protocol capability coverage.

## Verification

- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run audit:subscription`
- `npm run audit:backend`
- `npm run audit:release`

## Artifact

Source-only; no installer generated for this small version.
SHA-256: Source-only
