# Aegos 2.6.3

## Highlights

- Adds a UI freeze watchdog that records page, node count, speed-test state, foreground/background busy counters, and recent IPC commands when the WebView main thread stalls.
- Gives foreground navigation and input priority: status refresh, job sync, node refresh, speed-test node refresh, and auto recovery now yield while the user is actively clicking or typing.
- Hides inactive pages with `display: none` so hidden panels do not participate in WebView2 layout/composition during rapid sidebar switching.
- Keeps the 8,000-node rapid-navigation performance stress test active for regression coverage.

## Verification

- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run smoke:perf`
- `npm run audit:release`
- `npm run build`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.6.3_x64-setup.exe`
- Size: `15,272,339 bytes`
- SHA-256: `7a0e9df3a96c39d57a92dcb703a0a9e8ee44616c84973dbd139d20046cd01d80`
