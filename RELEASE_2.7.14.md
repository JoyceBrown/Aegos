# Aegos 2.7.14

## Changes

- Replaced the main text/symbol icons with a lightweight SVG-mask glass icon system.
- Refreshed sidebar navigation, home metrics, quick actions, node row actions, search, connection checkmark, and the Aegos brand mark.
- Kept page layout, control sizes, event handlers, and background job logic unchanged.
- Added a release audit guard so the UI does not regress back to raw text glyph icons.

## Verification

- `node --check src/app.js`
- `node --check tools/interaction-smoke.js`
- `node --check tools/release-audit.js`
- `npm run smoke:ui`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run audit:backend`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `npm run audit:release`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.7.14_x64-setup.exe`
- SHA-256: `711b995a51be3157dbcad63f36485a98d09bdfaaab0571a5366b5c9333f56d24`
