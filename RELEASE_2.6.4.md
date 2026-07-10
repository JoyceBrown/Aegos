# Aegos 2.6.4

## Highlights

- Stops Diagnostics page navigation from automatically running the heavier backend diagnostics workflow.
- Keeps Diagnostics navigation cache-only: previous results are shown immediately, and full checks run only when the user clicks Run Diagnostics or copies a report without cached data.
- Reduces Logs page pressure by rendering fewer rows per paint and limiting `app_status` log payloads to recent entries.
- Adds regression coverage that verifies Diagnostics navigation does not auto-run heavy diagnostics after settling.

## Verification

- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run smoke:perf`
- `npm run audit:release`
- `npm run build`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.6.4_x64-setup.exe`
- Size: `15278994`
- SHA-256: `46701d66fc3c878199270ed9e77dd946069bf208f49c430b8a939569f66d3dcf`
