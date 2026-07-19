# Aegos 3.6.40

## Delivered functionality

- Added safe DNS policy choices and runtime contracts.
- Completed manual-node support for modern protocol fields, including VLESS Reality and separate TUIC UUID/password values.
- Added protocol-aware form guidance and immediate validation before profile writes.

## Verification

- JavaScript syntax check and `npm run check` passed.
- `cargo test --manifest-path src-tauri/Cargo.toml` passed: 163 tests.
- `npm run audit:backend` and `npm run smoke:ui` passed.
- Local no-takeover installer validation passed: silent install, standby app start, and silent uninstall all returned success. FlClash remained running (one process) and the existing `127.0.0.1:7890` Windows proxy was unchanged.

## Artifact

- `src-tauri/target/release/bundle/nsis/Aegos_3.6.40_x64-setup.exe`
- SHA-256: `C43834674F65E0F59A84B8810F670EF25C4C94F49372FCA8758C3C4728F09495`
- Size: 16,107,066 bytes

This is the completed local build. It has not been externally published or code-signed.
