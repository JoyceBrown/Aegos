# Aegos 2.6.16

## Changes

- Reworked Disconnect Protection firewall rule creation to use normalized executable paths and `netsh` allow rules.
- Forced PowerShell command output to UTF-8 so protection errors are readable.
- Added rollback diagnostics when Disconnect Protection only partially applies.
- Added log export from the Logs page.
- Removed the duplicate small title text from the top-left titlebar.

## Verification

- `node --check src/app.js`
- `node --check tools/interaction-smoke.js`
- `node --check tools/release-audit.js`
- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run smoke:perf`
- `npm run build`
- `npm run audit:release`

## Artifact

Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.6.16_x64-setup.exe`

SHA-256: `a4cacf5244e893fbb626279d041f32ea9f694a3c6c7db767cbb759766f57594d`
