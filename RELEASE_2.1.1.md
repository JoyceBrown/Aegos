# Aegos 2.1.1

## Highlights

- Added subscription source validation before import/update is applied.
- Rejected empty, unsupported, or node-less subscriptions before writing profile files.
- Preserved the previous working profile file when a subscription update fails validation.
- Added profile node-count metadata and displayed it in the subscription list.
- Added audit coverage for source-only releases and subscription preflight wiring.

## Verification

- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run audit:backend`
- `npm run audit:release`

## Artifact

- Source-only: no installer was built for this small version.
- SHA-256: Source-only; no installer artifact.
