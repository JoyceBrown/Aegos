# Aegos 0.5.8

## Fixes

- Removed the duplicated proxy-port and outbound-IP rows from the sidebar status card.
- Locked the home common-node header and rows to the same fixed grid template.
- Kept proxy-port and outbound-IP metric columns exactly equal width.
- Changed speed tests to collect every node from every group and update every matching row.
- Added interaction-smoke assertions that home and node-page delay cells show `ms` after speed tests.
- Rebuilt node row renderers with encoding-safe status text.

## Verification

- `node --check src\app.js`
- `node --check tools\interaction-smoke.js`
- `cargo check --manifest-path src-tauri\Cargo.toml`
- `npm run smoke:ui`
- `npm run smoke:interactions`

## Artifact

- `src-tauri/target/release/bundle/nsis/Aegos_0.5.8_x64-setup.exe`
- SHA-256: `cf1f67e2f9263b8b7aecddcff4d84c9056bb41799ce8f2b7c0be71bb279b1d52`
