# Aegos 3.6.16

Stage 5 acceptance checkpoint: Windows takeover and crash recovery.

## Mainline Carry-Forward

- Current mainline: 3.5.71 - 3.6.40.
- Stage 2 pressure checkpoint 3.5.86 remains mandatory; background work must not lock navigation or foreground controls.
- Stage 3 ordinary-user routing and Stage 4 configuration deployment remain release gates, not archived documentation.

## Delivered

- 3.6.9: persistent transactions for system proxy, firewall, and TUN mutations.
- 3.6.10: interrupted-transaction and unclean-shutdown lease recovery at startup.
- 3.6.11: complete manual proxy, bypass, PAC URL, and auto-detect snapshot/restore.
- 3.6.12: unified exact-prefix Aegos firewall cleanup with post-clean verification.
- 3.6.13: TUN candidate, controller, DNS, adapter, route, and connectivity validation.
- 3.6.14: crash-state fault injection and clean-exit restoration paths.
- 3.6.15: read-only FlClash/Clash/VPN, port, adapter, and route conflict report.
- 3.6.16: regression gates and acceptance installer.

## Verification

- Passed: `cargo test --manifest-path src-tauri/Cargo.toml` (110 tests)
- Passed: `npm run audit:system-takeover-stage5`
- Passed: `npm run audit:takeover`
- Passed: `npm run audit:config-deployment`
- Passed: `npm run audit:current-mainline`
- Passed: `npm run audit:phase2-pressure`
- Passed: `npm run audit:stage2-closure`
- Passed: `npm run audit:runtime-regression`
- Passed: `npm run audit:installer-regression`
- Passed: `npm run audit:stability`
- Passed: `npm run audit:core-runtime`
- Passed: `npm run audit:stage3-acceptance`
- Passed: `npm run smoke:interactions`
- Passed: `npm run smoke:perf`
- Passed: `cargo check --manifest-path src-tauri/Cargo.toml`
- Passed: `npm run audit:release`
- Passed: `npm run build`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.16_x64-setup.exe`
- SHA-256: 65bccb1b8316e0e3c7c2dceeb90bf9098e0af125612247d97aa6954b118662c9

## Remaining Real-Machine Acceptance

- Run as administrator and force-terminate Aegos once with TUN active and once with disconnect protection active; relaunch and confirm the startup recovery report and normal Windows networking.
- Repeat on a second Windows device because virtual-adapter and enterprise firewall behavior cannot be fully simulated by source-level fault injection.
