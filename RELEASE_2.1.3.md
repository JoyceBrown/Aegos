# Aegos 2.1.3

## Highlights

- Added job-center actions for background tasks.
- Running jobs can receive a cancel request from the sidebar job center.
- Failed or cancelled jobs can be retried with their original payload.
- Backend queued jobs now stay cancelled if the cancel request arrives before worker execution.
- Interaction and release audits now cover job-center actions.

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
