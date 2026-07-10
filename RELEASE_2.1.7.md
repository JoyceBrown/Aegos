# Aegos 2.1.7

## Highlights

- Made active profile switching transactional while the core is running.
- If the target profile passes preflight but core startup still fails, Aegos restores the previous active profile.
- Rollback attempts to restart the previous profile and reports both target and rollback failures when needed.
- Backend and release audits now enforce switch preflight plus rollback behavior.

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
