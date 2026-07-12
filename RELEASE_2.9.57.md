# Aegos 2.9.57

Source-only release. No installer was built for this checkpoint.

## Changes
- Added `installer-regression-checklist.md` for real Windows installer regression checks.
- Added `audit:installer-regression` to verify the checklist covers install prerequisites, WebView2, proxy/firewall recovery, subscription/speed regressions, UI responsiveness, and automated gates.
- Wired installer regression checks into release audit.
- Bumped package, Tauri, Cargo, and sidebar versions to 2.9.57.

## Verification
- `npm run audit:installer-regression`
- `npm run audit:installer`
- `npm run audit:release`
- `git diff --check`

## Artifact
- Source-only: no installer for 2.9.57.
- SHA-256: Source-only
