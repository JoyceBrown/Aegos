# Aegos 2.9.8

Stable candidate release.

## Changes

- Promoted the 2.9.x reliability line to a stable candidate checkpoint.
- Includes subscription diagnostics, parser compatibility, protocol capability checks, node switch preflight, connection closure, failure classification, speed confidence, controlled recovery suggestions, node diagnostics, and soak stability coverage.
- No feature churn in this checkpoint; focus is verification and installer packaging.

## Verification

- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run audit:subscription`
- `npm run audit:subscription-fixtures`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run smoke:interactions`
- `npm run smoke:soak`
- `npm run build`

## Artifact

Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.9.8_x64-setup.exe`
Size: 15,376,425 bytes
SHA-256: c4356d5822b92d256b828a03eae2a394b0e0e48a83dee9a8adeb196f93bed0db
