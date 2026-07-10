# Aegos 2.6.5

## Highlights

- Fixes the window activation/drag-region ACL warning: `plugin:window|start_dragging not allowed by ACL`.
- Grants the native Tauri window drag permission used by `data-tauri-drag-region`.
- Removes the duplicated frontend `window_start_dragging` IPC path so window activation and dragging use one native path.
- Updates release audit coverage for native drag-region permissions.

## Verification

- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run smoke:perf`
- `npm run audit:release`
- `npm run build`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.6.5_x64-setup.exe`
- Size: `15277913`
- SHA-256: `ec116ea6e371ea42527924fb6eaf683e43f24e44d0ac2c25a5f38ac190d9b4d3`
