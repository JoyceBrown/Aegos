# Aegos 2.9.40

## Changes
- Simplified node address display with compact host text while preserving the full address in hover details.
- Added a dedicated node speed status column after latency.
- Kept latency as a pure numeric/testing field so failed speed tests no longer look like stale latency values.
- Moved timeout/DNS/TLS/auth/controller/config/network failure labels into the status column.
- Updated fast single-node speed UI refresh to use semantic cells instead of brittle column indexes.
- Synchronized speed/release/interaction audits with the new status-column contract.

## Verification
- `node --check src\app.js`
- `node --check tools\speed-closure-audit.js`
- `node --check tools\release-audit.js`
- `npm run audit:speed`
- `npm run audit:release`
- `npm run smoke:interactions`
- `npm run smoke:ui`

## Artifact
- Source-only checkpoint. Installer not built in this step.
- SHA-256: source-only
