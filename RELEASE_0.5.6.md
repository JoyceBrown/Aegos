# Aegos 0.5.6

## Fixes

- Prevented transient controller checks from making a running core appear disconnected.
- Normalized mihomo proxy delay history into the `delay` field used by the UI.
- Increased node-delay controller timeout to match the core delay-test timeout.
- Changed the home current-node title to prefer the selected node name instead of the subscription name.
- Rebuilt the home common-node list as an information table with node name, address, delay, packet loss, and status.
- Removed the node-page action buttons from the home common-node list.
- Narrowed upload and download metric columns without clipping their text.

## Verification

- `node --check src\app.js`
- `cargo check --manifest-path src-tauri\Cargo.toml`
- `npm run smoke:ui`
- `npm run smoke:interactions`

## Artifact

- `src-tauri/target/release/bundle/nsis/Aegos_0.5.6_x64-setup.exe`
- SHA-256: `5b58b3bb948c96f5e0afd9592df09263f1a8c1c808df8a118d73ae26884bdf44`
