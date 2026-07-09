# Aegos 0.5.7

## Fixes

- Made proxy-port and outbound-IP metric columns use equal widths.
- Locked the home common-node table header and rows to the same fixed column template.
- Changed one-click speed test from first-8-only to all-node concurrent testing.
- Returned measured delay values directly from the backend so home, node page, and region filters update from the same data.
- Added a real outbound-IP refresh command that queries public IP through the active local proxy.
- Added interaction-smoke coverage for outbound-IP refresh.

## Verification

- `node --check src\app.js`
- `cargo check --manifest-path src-tauri\Cargo.toml`
- `npm run smoke:ui`
- `npm run smoke:interactions`

## Artifact

- `src-tauri/target/release/bundle/nsis/Aegos_0.5.7_x64-setup.exe`
- SHA-256: `0901b1b236061f549e4f423cb53f169b6f48eda03da6ea5485f0ee0e318b1cfe`
