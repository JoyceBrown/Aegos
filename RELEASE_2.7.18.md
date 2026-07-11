# Aegos 2.7.18

## Changes

- Added a dedicated landing-IP closure audit.
- Guarded smart/rule-mode landing IP routing through the hidden current-node group.
- Guarded stale-request suppression, cache fallback, connect/node-switch refresh triggers, provider validation, and short timeout behavior.

## Verification

- `node --check tools/outbound-ip-audit.js`
- `npm run audit:outbound-ip`
- `npm run audit:backend`
- `npm run audit:release`

## Artifact

- Source-only release; no installer for this landing-IP audit checkpoint.
- SHA-256: Source-only
