# Aegos 2.9.56

Source-only release. No installer was built for this checkpoint.

## Changes
- Added `provider-healthcheck-contract.md` to define provider healthcheck as subscription/provider health, not node switching.
- Added `audit:provider-healthcheck` to keep provider healthcheck out of ordinary speed tests and UI until Aegos can prove it does not change current selection.
- Wired the provider healthcheck gate into release audit.
- Bumped package, Tauri, Cargo, and sidebar versions to 2.9.56.

## Verification
- `npm run audit:provider-healthcheck`
- `npm run audit:speed`
- `npm run audit:release`
- `git diff --check`

## Artifact
- Source-only: no installer for 2.9.56.
- SHA-256: Source-only
