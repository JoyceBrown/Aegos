# Aegos 3.6.38 candidate

## Product change

- Manual-node editing now keeps the TUIC UUID and password as separate required values.
- The editor gives protocol-specific guidance and only shows the TUIC password field for TUIC.
- Backend validation rejects missing protocol credentials and malformed VLESS Reality configuration before it is written to the profile.

## Verification

- `npm run check` passed.
- `cargo test --manifest-path src-tauri/Cargo.toml` passed: 163 tests.
- `npm run audit:backend` and `npm run smoke:ui` passed.
- Local, no-takeover installer validation passed: silent install, standby application start, silent uninstall. FlClash stayed at one process and the pre-existing Windows proxy remained `127.0.0.1:7890`.

## Artifact

- `src-tauri/target/release/bundle/nsis/Aegos_3.6.38_x64-setup.exe`
- SHA-256: `D860A9EB207D772C3055E03923479492485D23BE31E0D53A1065F98C92E8F1FE`
- Size: 16,104,376 bytes

This is an internal sequential candidate, not a published release.
