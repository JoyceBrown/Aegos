# Aegos 2.9.32

Source-only checkpoint for the progressive speed-test scheduler.

## Changes

- Added a two-depth delay probe model: `Fast` and `Full`.
- Fast probes use the same primary URL as FlClash with shorter protocol-aware timeouts, so healthy nodes can return visible results earlier.
- Full probes still use the 5000 ms FlClash-aligned baseline plus fallback URLs, so difficult nodes are not incorrectly discarded by the fast pass.
- Recovery suggestions now continue to share the same measurement path as batch and single-node tests.
- Extended speed audit coverage so future changes cannot remove the fast/full split or the FlClash-aligned full probe baseline.

## Notes

- This is not an installer checkpoint.
- Installer: Source-only

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `npm run audit:speed`
- `npm run audit:backend`
- `npm run audit:security`
- `npm run audit:release`

## Artifact

- Installer: Source-only
- SHA-256: Source-only
