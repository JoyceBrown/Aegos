# Aegos 2.1.2

## Highlights

- Added a lightweight global background job center in the sidebar.
- Wired `runBackgroundJob` into a shared job store so active and recent tasks remain visible.
- Kept job center polling idle unless active jobs exist, preserving cached navigation responsiveness.
- Added release and interaction audit coverage for the job center.

## Verification

- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run smoke:ui`
- `npm run audit:backend`
- `npm run audit:release`

## Artifact

- Source-only: no installer was built for this small version.
- SHA-256: Source-only; no installer artifact.
