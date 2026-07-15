# Aegos 3.5.74

## Scope

- Added a shared `statusSurfaceNotice()` helper for the home status notice.
- Strengthened user-facing explanations for stopped, standby, takeover, stale network, unavailable network, and system-proxy pending states.
- Extended `audit:status-vocabulary` so the home notice must be derived from the same status snapshot used by the sidebar.

## User Impact

- The home notice now explains what is wrong or pending instead of only saying whether traffic is connected.
- Status messages stay lightweight: rendering a warning does not start diagnostics, speed tests, or IP lookups.

## Verification

- Passed: `node -c src/app.js`
- Passed: `npm run audit:status-vocabulary`
- Passed: `npm run audit:release`
- Passed: `git diff --check`

## Artifact

- Source-only checkpoint: no installer was built for 3.5.74.
- SHA-256: Source-only / not applicable.
