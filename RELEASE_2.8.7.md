# Aegos 2.8.7

Stable candidate checkpoint for the 2.8 subscription/protocol compatibility line.

## Changes

- Promoted the 2.8 subscription compatibility work to a packaged stable candidate.
- Kept 2.8.3 failure diagnostics, 2.8.4 parser compatibility, 2.8.5 protocol capability matrix, and 2.8.6 sanitized fixture regression under release gates.
- Built a fresh NSIS installer for user testing.

## Verification

- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run audit:subscription`
- `npm run audit:subscription-fixtures`
- `npm run audit:backend`
- `npm run smoke:interactions`
- `npm run build`
- `npm run audit:release`

## Artifact

- Path: `src-tauri/target/release/bundle/nsis/Aegos_2.8.7_x64-setup.exe`
- Size: `15,341,806 bytes`
- SHA-256: `6a175f6f9193534d3751183486436c8be11d4c57dfac664c5e6e0340a3578af7`
