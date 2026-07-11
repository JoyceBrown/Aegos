# Aegos 2.9.11

## Changes

- Replaced the current-node latency refresh icon with a compact speed icon.
- Removed the colored background block from the home stability metric.
- Home stability now uses text-only status color: high green, medium amber, low red.
- Added interaction and release checks so the home stability metric cannot regress into a colored block.

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

`src-tauri/target/release/bundle/nsis/Aegos_2.9.11_x64-setup.exe`

SHA-256: d853241e238daa844be0a869b36f8e347ed866c04b5421ede2b04e5c7c461135
