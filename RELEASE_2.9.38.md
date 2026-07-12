# Aegos 2.9.38

Source-only release.

## Focus

- Tested nodes must not fall back to an untested display state after a failed speed test.
- Failed speed tests now keep and show a structured failure reason such as timeout, DNS failure, TLS failure, authentication failure, controller unavailable, unsupported protocol, configuration error, or network failure.

## Changes

- Added structured delay-test results with `delay` and `failureReason`.
- Stored the last failed speed-test reason in node health as `lastFailureReason`.
- Classified failed delay tests through the existing failure classifier.
- Updated home and node delay/stability text so tested failures show concrete user-facing reasons instead of an untested state.
- Kept speed tests measurement-only; this change does not connect, switch, or select nodes.
- Added audit coverage so failure reasons cannot silently regress back to an untested display state.

## Verification

- `node --check src\app.js`
- `npm run check`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `npm run audit:speed`
- `npm run audit:backend`
- `npm run audit:security`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run smoke:perf`
- `npm run audit:release`

## Artifact

- Source-only; no installer produced for this patch.
- SHA-256: source-only
