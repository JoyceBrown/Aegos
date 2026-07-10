# Aegos 2.1.4

## Highlights

- Added an `updateAllProfiles` background job for refreshing every URL subscription.
- Batch subscription updates reuse the same per-profile download, parse, and runtime preflight validation.
- The batch job reports success/failure counts and can be cancelled between profile updates.
- Added a subscription-page control for updating all subscriptions without blocking navigation.
- Interaction and release audits now cover the batch subscription job.

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
