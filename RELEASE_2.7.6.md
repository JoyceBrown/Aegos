# Aegos 2.7.6

## Changes

- Stabilized the home hero row so the node area no longer shifts or gets squeezed at different window heights.
- Made outbound IP wider than upload/download metrics at minimum width.
- Refreshed disconnect-protection firewall allow rules before speed tests, including mihomo/Aegos executable rules and DNS service rules.
- Added audits to catch home layout and disconnect-protection speed-test regressions.

## Verification

- Passed: npm run check
- Passed: npm run smoke:ui
- Passed: npm run smoke:interactions
- Passed: npm run smoke:perf
- Passed: npm run audit:backend
- Passed: npm run build
- Passed: npm run audit:release

## Artifact

- Installer: src-tauri/target/release/bundle/nsis/Aegos_2.7.6_x64-setup.exe
- Size: 15,311,961 bytes
- SHA-256: 0ec1f518fd62ea26c45a0513cb55f651303edb318d950b72c9bb0dd602f0866c
