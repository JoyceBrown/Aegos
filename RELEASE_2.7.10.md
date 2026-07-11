# Aegos 2.7.10

Small interaction and speed-test stability patch.

- Moved disconnect-protection speed-test firewall setup into the background worker so quick/batch speed-test buttons can return immediately.
- Kept speed tests measurement-only; they still do not switch or connect nodes.
- Changed diagnostics running feedback to a local button busy state so page navigation and light UI interaction stay responsive.
- Stabilized the quick subscription popover: click to open, click again to close, click again to reopen; status refresh no longer rerenders it while open.
- Added smoke and release audit coverage for the subscription popover toggle and diagnostics local busy feedback.

## Verification

- `node --check src/app.js`
- `node --check tools/interaction-smoke.js`
- `npm run check`
- `npm run audit:backend`
- `npm run smoke:ui`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run build`
- `npm run audit:release`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.7.10_x64-setup.exe`
- SHA-256: `9b76c6d4d3533f8928dc08d1ab211b8cd627d993529bd5343971bba51d0e5665`
