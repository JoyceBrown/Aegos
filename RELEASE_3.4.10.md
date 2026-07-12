# Aegos 3.4.10

IPv6/DNS automatic safety acceptance checkpoint.

## Changes

- Completed the 3.4.x IPv6/DNS automatic safety lane.
- Added read-only IPv6/DNS safety snapshot command.
- Added settings-page IPv6/DNS safety card.
- Added audit and unit coverage for no connection changes during IPv6 fallback.

## Verification

- `node --check src/app.js`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml ipv6_dns_safety_auto_falls_back_without_connection_changes`
- `npm run audit:routing-assistant-maturity`
- `npm run audit:ipv6-dns-safety`
- `npm run audit:maturity`
- `npm run audit:release`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.4.10_x64-setup.exe`
- SHA-256: `F092B3CF84CABA52B5B4FB35B0B88B632CDC5D2A21883AD93525AD60D4CF738A`
