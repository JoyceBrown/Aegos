# Aegos 2.9.3

Source-only small release.

## Changes

- Added user-facing connection failure classification for node switch failures.
- Classified common failure causes including timeout, DNS, TLS, authentication, unsupported protocol, port conflict, controller availability, config, and network errors.
- Preserved node switch rollback behavior while returning clearer failure categories for diagnosis.
- Added backend and release audit coverage for the failure classifier wiring.

## Verification

- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run smoke:interactions`

## Artifact

Source-only; no installer generated for this small version.
SHA-256: Source-only
