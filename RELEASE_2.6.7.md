# Aegos 2.6.7

## Highlights

- Fixes Diagnostics page layout so summary cards and result rows do not overlap or clip when the page is opened.
- Removes the redundant status column from Home and Nodes tables.
- Reassigns node row actions to Speed Test, Edit, and Favorite, with labels in the operation header.
- Prevents failed single-node speed tests from leaving rows stuck in "testing" state.
- Adds Home node modes for frequent nodes, favorite nodes, common regions, and fixed nodes.
- Sorts frequent nodes by local usage, active/recommended state, and latency.
- Adds a fixed-node editor that saves user-added residential/static/manual nodes into the active profile pipeline.
- Persists local favorites and usage counts so common/favorite filters have immediate behavior.

## Verification

- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run smoke:perf`
- `npm run audit:release`
- `npm run build`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.6.7_x64-setup.exe`
- Size: `15,315,126 bytes`
- SHA-256: `57702586f1750f5a55073e971846c65ee7f24cd58e46e3fe0ee520c24565d090`
