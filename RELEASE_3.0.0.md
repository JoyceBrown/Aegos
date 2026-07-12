# Aegos 3.0.0

Source checkpoint for the 3.0 mature proxy-client foundation gate.

## Changes
- Added `ROADMAP_3.0.0_TO_3.6.4.md` as the strict execution contract for the
  3.0.0 to 3.6.4 development lane.
- Added `audit:maturity` to verify the 3.0 foundation gate: release, security,
  speed, stability, responsiveness, installer-regression, copy/encoding, and
  open-source absorption gates must stay wired before 3.1 work begins.
- Wired maturity checks into the release audit.
- Bumped package, Tauri, Cargo, and sidebar versions to 3.0.0.

## Verification
- `npm run audit:maturity`
- `npm run audit:release`
- `npm run audit:security`
- `npm run audit:speed`
- `npm run audit:responsiveness`
- `npm run audit:stability`
- `npm run audit:installer-regression`
- `npm run audit:copy`
- `npm run audit:opensource`
- `npm run audit:backend`
- `npm run audit:subscription`
- `npm run audit:subscription-fixtures`
- `npm run audit:outbound-ip`
- `npm run audit:diagnostics`
- `npm run audit:node-flow`
- `npm run audit:takeover`
- `npm run audit:architecture`
- `npm run audit:debt`
- `npm run audit:flclash`
- `npm run audit:speed-target`
- `npm run audit:provider-healthcheck`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run smoke:soak`
- `npm run check`
- `git diff --check`

## Artifact
- Source checkpoint: no installer built for this checkpoint yet.
- SHA-256: Source-only
