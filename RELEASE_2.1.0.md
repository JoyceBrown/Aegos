# Aegos 2.1.0

## Highlights

- Added a background job model for long operations: subscription import, subscription update, smart recovery, and outbound IP refresh.
- Moved subscription downloads and outbound IP network waits outside the main `CoreManager` mutex, reducing UI stalls while slow network work is in progress.
- Added frontend job polling through `start_job` / `job_status`, so navigation and cached pages remain responsive while background work runs.
- Paused non-forced status and node refresh while foreground actions or background jobs are active, preventing refresh loops from competing with user interactions.
- Updated interaction smoke coverage to verify all long-operation job kinds and preserve optimistic UI behavior.

## Verification

- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run smoke:perf`
- `npm run audit:backend`
- `npm run build`

## Artifact

- Installer: `src-tauri\target\release\bundle\nsis\Aegos_2.1.0_x64-setup.exe`
- SHA-256: `9050323f92e4e703c0428f54685f739833918f71e52d81038b60e980d71c3155`
