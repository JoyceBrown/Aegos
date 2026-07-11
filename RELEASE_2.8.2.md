# Aegos 2.8.2

## Changes

- Added URI subscription support for mainstream airport protocols: VLESS, Hysteria2/Hy2, and AnyTLS.
- Preserved Reality, WS, gRPC, SNI, ALPN, certificate-skip, fingerprint, and Hysteria2 obfs fields when converting URI subscriptions into Mihomo YAML.
- Added AnyTLS to protocol labeling, manual fixed-node protocol options, scheduler classification, and release/backend audits.

## Verification

- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `node --check src/app.js`
- `npm run audit:backend`
- `npm run audit:release`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.8.2_x64-setup.exe`
- Size: 15,364,700 bytes
- SHA-256: `e1431e577da28d788748e74ba24565d5cc1a8528da9e9a29f99c964aa2749c70`
