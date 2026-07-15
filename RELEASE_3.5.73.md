# Aegos 3.5.73

## Scope

- Replaced the low-value fixed DNS metric on the home page with 网络可用.
- Routed the home 网络可用 metric through the same `network.availability` helper as the sidebar.
- Added compact status text colors for available / warning / unavailable states.
- Extended `audit:status-vocabulary` to guard the home metric wiring.

## User Impact

- The first screen now tells the user whether the network has actually been verified, instead of showing a static DNS label.
- Home and sidebar status no longer drift: both read from the same availability snapshot.

## Verification

- Passed: `node -c src/app.js`
- Passed: `npm run audit:status-vocabulary`
- Passed: `npm run audit:release`
- Passed: `git diff --check`

## Artifact

- Source-only checkpoint: no installer was built for 3.5.73.
- SHA-256: Source-only / not applicable.
