# Aegos 2.1.6

## Highlights

- Moved profile deletion into the shared background job path as `removeProfile`.
- Deleting the active profile now stops the running core, switches to `direct`, and restarts cleanly.
- Non-active profile deletion remains lightweight and does not restart the core.
- Updated interaction, backend, and release audits to enforce backgrounded profile deletion.

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
