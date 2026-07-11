# Aegos 2.7.0

## Changes

- Refreshed the visual system with a soft glass background, unified 8px panel radius, tighter card spacing, and consistent icon badges.
- Reworked the home quick actions into one row.
- Removed the Smart Recovery and Quick Mode entries from quick actions while keeping recovery settings/backend capability.
- Polished sidebar, hero, metric cards, region tabs, node rows, and page cards for a more cohesive layout.
- Preserved existing optimistic UI, speed-test no-switch behavior, and navigation performance rules.

## Verification

- `node --check src/app.js`
- `node --check tools/interaction-smoke.js`
- `node --check tools/perf-smoke.js`
- `node --check tools/release-audit.js`
- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run smoke:perf`
- `npm run build`
- `npm run audit:release`

## Artifact

Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.7.0_x64-setup.exe`

SHA-256: `bbfe2a9ff7ab4179ac904c528ca2a83b862c2ffe441f1f2a9a7e8374f82c23ee`
