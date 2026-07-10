# Aegos 2.0.2

## Highlights

- Reworked sidebar navigation into a cached-view model: menu clicks only switch already-mounted page layers.
- Added a 550 ms navigation quiet period before page-specific data refreshes, so rapid back-and-forth menu clicks do not trigger connection or diagnostic requests.
- Moved pages to absolute cached layers inside the workspace, keeping inactive pages out of normal grid layout calculation.
- Pre-warmed static subscription and log pages after status sync, so opening those pages uses cached DOM instead of rendering during navigation.
- Reduced navigation repaint work by only updating region and node-filter button states when those filters actually change.
- Added regression coverage for rapid cached navigation.

## Verification

- `node --check src\app.js`
- `node --check tools\interaction-smoke.js`
- `node --check tools\release-audit.js`
- `cargo check --manifest-path src-tauri\Cargo.toml`
- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run audit:release`
- `npm run build`

## Artifact

- Installer: `src-tauri\target\release\bundle\nsis\Aegos_2.0.2_x64-setup.exe`
- SHA-256: `540182b6089b6be8a0056eccb8cbe8f3b0c0c44ecb752394f1620f86f0c15c2f`
