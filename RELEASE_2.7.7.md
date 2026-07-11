# Aegos 2.7.7

## Changes

- Fixed home hero display logic by centering the left connection group and right node-info group under one alignment model.
- Reduced the outbound IP metric width to a readable minimum and kept upload/download compact.
- Improved disconnect-protection speed tests with temporary node-port firewall rules that are opened for the test and cleaned afterward.
- Added UI and backend audits for hero center alignment, metric proportions, and disconnect-protection speed-test rules.

## Verification

- Passed: npm run check
- Passed: npm run smoke:ui
- Passed: npm run smoke:interactions
- Passed: npm run smoke:perf
- Passed: npm run audit:backend
- Passed: npm run build
- Passed: npm run audit:release

## Artifact

- Installer: src-tauri/target/release/bundle/nsis/Aegos_2.7.7_x64-setup.exe
- Size: 15,316,993 bytes
- SHA-256: b69797c84ba6042a559b27a5f02a1628619547e71ba0660bc7a1cbe30c982696
