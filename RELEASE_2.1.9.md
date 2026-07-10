# Aegos 2.1.9

## Highlights

- Clean up failed core startups so the app does not keep a stale running state when the controller never becomes ready.
- Preserve the user's system proxy intent across restart-style operations.
- Make subscription import transactional while the core is running: failed startup removes the newly imported profile and restores the previous active profile.
- Make active subscription updates transactional: failed save or restart restores the previous profile file and metadata.
- Guard against a subscription being removed while a background update is still downloading.

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
