# Aegos 2.6.8

## Changes

- Home now separates current node and recommended node with short labels.
- Speed test updates delay, recommendation, and low-latency data only; it does not switch proxies.
- Renamed the explicit connection action to "切换到推荐".
- Recommended node chips are informational and no longer connect directly.
- Automatic strategy groups show a warning and provide a current-node lock entry.
- Replaced low-value home upload/download widgets with strategy and recommendation status.

## Verification

- `node --check src/app.js`
- `node --check tools/interaction-smoke.js`
- `node --check tools/release-audit.js`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run smoke:perf`

## Artifact

Source-only checkpoint. No installer was produced for this small version.

SHA-256: Source-only
