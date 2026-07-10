# Aegos 2.1.5

## Highlights

- Added profile switch preflight before saving `activeProfileId`.
- Switching to a broken or incompatible historical subscription now fails before changing the active profile.
- Reused the runtime config preflight path for switch validation.
- Added backend and release audit coverage for switch-before-save safety.

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
