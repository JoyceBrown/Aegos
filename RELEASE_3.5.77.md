# Aegos 3.5.77

## Scope

- Added `connectionButtonLabel()` for explicit connection button states.
- The connection button now shows `连接中` / `断开中` during pending core power operations, then reconciles from the next status snapshot.
- Extended status vocabulary and release audits to guard the pending-label path.

## User Impact

- Clicking Connect or Disconnect gives immediate, understandable feedback.
- Pending feedback is UI-only and does not pretend the backend has already succeeded.
- Navigation remains available while the core power job runs in the background.

## Verification

- Passed: `node -c src/app.js`
- Passed: `npm run audit:status-vocabulary`
- Passed: `npm run smoke:interactions`
- Passed: `npm run audit:release`
- Passed: `git diff --check`

## Artifact

- Source-only checkpoint: no installer was built for 3.5.77.
- SHA-256: Source-only / not applicable.
