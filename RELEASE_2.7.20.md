# Aegos 2.7.20

## Changes

- Added a dedicated responsiveness audit for navigation, menus, filters, diagnostics, speed tests, and large node lists.
- Guarded deferred page loading, foreground/background scheduler yielding, visible-surface speed refresh, and windowed/cached node rendering.
- Kept this checkpoint source-only; 2.8.0 remains the installer checkpoint.

## Verification

- `node --check tools/responsiveness-audit.js`
- `npm run audit:responsiveness`
- `npm run smoke:perf`
- `npm run smoke:interactions`
- `npm run audit:release`
- `npm run check`

## Artifact

- Source-only release; no installer for this responsiveness audit checkpoint.
- SHA-256: Source-only
