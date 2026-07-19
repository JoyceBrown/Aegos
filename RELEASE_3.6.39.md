# Aegos 3.6.39 candidate

## Product change

- Manual-node editor now changes the credential label and placeholder by protocol.
- Required UUID/password, server, port, and VLESS Reality public-key checks run before saving, with direct user-facing messages.

## Verification

- JavaScript syntax, `npm run check`, 163 Rust tests, backend audit, and UI smoke test passed.
- Local no-takeover installer validation passed; FlClash and the existing Windows proxy were unchanged.

## Artifact

- `src-tauri/target/release/bundle/nsis/Aegos_3.6.39_x64-setup.exe`
- Size: 16,109,013 bytes

This is an internal sequential candidate, not a published release.
