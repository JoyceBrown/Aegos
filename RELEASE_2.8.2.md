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

- Source-only release; no installer requested for this subscription protocol expansion.
- SHA-256: Source-only
