# Aegos 2.9.55

Source-only release. No installer was built for this checkpoint.

## Changes
- Added `speed-target-contract.md` to lock speed-test URL, expected behavior, full diagnostic target family, and failure reason vocabulary.
- Added `audit:speed-target` to verify batch target alignment, single-node diagnostic targets, backend failure classifier coverage, frontend failure labels, and visible failed-node reason state.
- Wired the speed target contract gate into release audit.
- Bumped package, Tauri, Cargo, and sidebar versions to 2.9.55.

## Verification
- `npm run audit:speed-target`
- `npm run audit:speed`
- `npm run audit:release`
- `git diff --check`

## Artifact
- Source-only: no installer for 2.9.55.
- SHA-256: Source-only
