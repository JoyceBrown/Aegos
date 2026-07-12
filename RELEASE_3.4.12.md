# Aegos 3.4.12

Source-only maturity recovery checkpoint. No installer is produced for this small version.

## Purpose

3.4.12 productizes the core connection closure: connect, disconnect, system proxy, TUN, traffic takeover, and outbound IP state must be understandable and consistent.

## Completed

- Added backend `connection_phase` and `connection_status_summary`.
- Added lightweight `status.connection` for frontend state rendering.
- Extended job `connection_closure` with phase, label, next action, current node, and outbound IP.
- Updated frontend system proxy display to use backend wanted/applied state.
- Kept the side network status system proxy row visible at all times.
- Added danger styling for incomplete system proxy takeover.
- Added `tools/connection-closure-audit.js`.
- Wired `audit:connection-closure` into package and release audit.
- Bumped package, Tauri, Cargo, lockfiles, and sidebar version to 3.4.12.

## Verification

- `node --check tools/connection-closure-audit.js`
- `npm run audit:connection-closure`
- `npm run audit:product-maturity`
- `npm run audit:release`
- `npm run check`
- `git diff --check`

## Artifact

Source-only checkpoint. No installer was produced for 3.4.12.

SHA-256: source-only
