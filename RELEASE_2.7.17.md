# Aegos 2.7.17

## Changes

- Stabilized the home node row ordering so selecting a node changes highlight/state without moving the row.
- Kept common region, favorite, frequent, and fixed-node filtering behavior unchanged.
- Added interaction and release audit coverage to prevent selected-node priority from re-entering the home row sorter.

## Verification

- `node --check src/app.js`
- `node --check tools/interaction-smoke.js`
- `node --check tools/release-audit.js`
- `npm run smoke:interactions`
- `npm run audit:release`

## Artifact

- Source-only release; no installer for this node-order stability checkpoint.
- SHA-256: Source-only
