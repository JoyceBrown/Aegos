# Aegos 2.9.10

## Changes

- Fixed icon-only busy states so current-node refresh and node-row test buttons never render `测速中...` text into compact UI.
- Added fixed-size visual pending feedback for icon-only buttons with spinner animation instead of text replacement.
- Added interaction and release audit coverage for busy text leakage and width changes on compact icon buttons.

## Verification

- `node --check src\app.js`
- `node --check tools\interaction-smoke.js`
- `node --check tools\release-audit.js`
- `npm run check`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `npm run build`

## Artifact

Installer:

`src-tauri/target/release/bundle/nsis/Aegos_2.9.10_x64-setup.exe`

SHA-256: 0350c296f881f7401fa40fc81ed2af01ee79ce3821e07de588d6f812903257da
