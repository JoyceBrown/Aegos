# Aegos 2.7.22

## Changes

- Added a lightweight real-scenario soak smoke harness.
- The harness runs repeated mocked daily-use loops across connect/disconnect, profile switching, batch speed tests, diagnostics, logs, status refreshes, search, and page switching.
- Kept the harness isolated from real system proxy/network state so it can run safely during development.

## Verification

- `node --check tools/soak-smoke.js`
- `npm run smoke:soak`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run audit:release`
- `npm run check`

## Artifact

- Source-only release; no installer for this soak checkpoint.
- SHA-256: Source-only
