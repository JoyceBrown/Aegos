# Aegos 2.9.12

## Changes

- Renamed the network status label from "内网 IP" to "局域网 IP".
- Hardened LAN IP detection so the status card only shows usable private LAN addresses and rejects loopback, unspecified, multicast, and public addresses.
- Added release and interaction smoke coverage for the LAN IP label and rendered value.

## Verification

- `node --check src/app.js`
- `node --check tools/interaction-smoke.js`
- `node --check tools/release-audit.js`
- `npm run audit:backend`
- `npm run audit:subscription`
- `npm run audit:subscription-fixtures`
- `npm run audit:outbound-ip`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run build`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.9.12_x64-setup.exe`
- Size: 15,380,170 bytes
- SHA-256: `a183b6a6f5da5301ec895290a3a3ba4c4c54e1c3ef479f046ee893636f85646e`
