# Aegos 3.6.50

## Scope

- Fix authenticated HTTP and SOCKS5 fixed nodes that previously saved a
  password without the service username.
- Keep HTTP port and SOCKS5 port selection explicit and controlled by the
  service provider's endpoint information.

## User Experience

- HTTP and SOCKS5 now show a dedicated username field in the fixed-node
  editor.
- Existing authenticated nodes restore the username when reopened for editing.
- Protocol guidance states that the node name is display-only and is not an
  authentication username.
- Other protocols keep the authentication field hidden to avoid irrelevant
  form density.

## Runtime Safety

- The existing typed `ManualNodeConfig` path writes `username` and `password`
  into the Mihomo runtime proxy entry without adding a second protocol engine.
- Tests use reserved addresses and fixture credentials; no real endpoint or
  credential is included in source, logs, screenshots, or release metadata.
- Verification does not stop or modify FlClash.

## Verification

- 182 Rust unit tests
- Authenticated SOCKS5 runtime serialization regression
- Full interaction smoke including authenticated fixed-node submission
- UI viewport/DPI smoke, copy encoding, configuration-domain, and release gates

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.50_x64-setup.exe`
- SHA-256: `a2dc4d02ab45a4d4ab739293ea83150a3f76984cc9cd3b293d2a14d85a0852d9`
