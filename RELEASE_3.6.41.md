# Aegos 3.6.41 candidate

## Delivered functionality

- Repaired release and product-maturity evidence gates so they reflect the current product structure.
- Added a sanitized offline acceptance gate for native config, modern URI, unsupported-protocol, subscription, and recovery paths.
- Added explicit Provider healthcheck: it is a background, read-only task and verifies that node selection, system proxy, TUN, and traffic takeover remain unchanged.
- Added Windows tray lifecycle: close hides Aegos to the tray; explicit exit restores the existing network shutdown path; a second launch restores the existing instance instead of starting another core.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`: 164 passed, 0 failed.
- `npm run check`, offline acceptance, provider-healthcheck, tray, connection-closure, IPv6/DNS, routing-product, product-maturity, security, UI, interaction, product-journey, performance-repeat, and soak gates passed.
- Local isolated silent installation completed successfully. It preserved the active FlClash process and Windows proxy (`127.0.0.1:7890`); Aegos was kept in standby and never took over traffic.
- Manual Windows validation: native close hid Aegos while its process remained alive; a second launch restored the same window and the process count remained one.

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.41_x64-setup.exe`
- Size: 16,162,920 bytes
- SHA-256: `B72B6A3F8EE08BD8CAD3DB2E9027AB298388020DA18A55E447D52034B1DCE7F1`
