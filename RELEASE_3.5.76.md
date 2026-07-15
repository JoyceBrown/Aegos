# Aegos 3.5.76

## Scope

- Added cache/TTL control for settings-page environment checks so quick page switching does not repeat IPv6/DNS and readiness probes.
- Strengthened `audit:responsiveness` to require pure `renderStatus()` painting with no heavy backend calls.
- Strengthened release audit so deferred navigation also covers settings-page background checks.

## User Impact

- Switching pages remains immediate while background checks wait for the quiet period.
- Repeatedly entering Settings no longer starts the same environment checks on every quick navigation.

## Verification

- Passed: `node -c src/app.js`
- Passed: `npm run audit:responsiveness`
- Passed: `npm run smoke:interactions`
- Passed: `npm run audit:release`
- Passed: `git diff --check`

## Artifact

- Source-only checkpoint: no installer was built for 3.5.76.
- SHA-256: Source-only / not applicable.
