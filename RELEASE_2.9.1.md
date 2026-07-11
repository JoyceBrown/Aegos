# Aegos 2.9.1

Source-only small release.

## Changes

- Added node switch preflight before mutating selected proxy state.
- Validates that the target group exists and the requested node is present in that group.
- Supports matching by displayed node name or resolved real proxy name.
- Logs successful node switch preflight details before applying the controller request.
- Added unit and audit coverage for group/node preflight.

## Verification

- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run audit:backend`
- `npm run audit:release`

## Artifact

Source-only; no installer generated for this small version.
SHA-256: Source-only
