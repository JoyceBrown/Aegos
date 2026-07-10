# Aegos 2.6.2

## Highlights

- Fixes real-world sidebar freezes caused by hidden/global node refresh work blocking the WebView main thread.
- Defers node DOM rendering when the current page is not Home or Nodes, so repeated sidebar navigation is not held by hidden node-list updates.
- Replaces repeated full-list normalize/filter/sort rendering with a single-pass visible-row renderer for large subscriptions.
- Throttles speed-test node refreshes from every poll to at most once per 1.2 seconds, while still refreshing when the test completes.
- Strengthens the performance smoke test to run 420 rapid sidebar switches while an 8,000-node speed-test workload is active.

## Verification

- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run smoke:perf`
- `npm run audit:release`
- `npm run build`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.6.2_x64-setup.exe`
- Size: `15,276,763 bytes`
- SHA-256: `5505cd6309e1729e36cb72033e8798daa8ab00f50e7fdd1f6ef325197314d66a`
