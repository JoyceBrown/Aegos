# Aegos 3.1.4

Source checkpoint for routing strategy type classification.

## Changes
- Added `audit:routing-types` to guard strategy type normalization and labels.
- Canonicalized backend strategy types such as `URLTest` and `LoadBalance` into
  `url-test` and `load-balance`.
- Updated frontend labels so select, url-test, fallback, and load-balance are
  displayed consistently regardless of casing or separators.
- Kept strategy classification read-only; no routing config writes were added.
- Bumped package, Tauri, Cargo, and sidebar versions to 3.1.4.

## Verification
- `npm install --package-lock-only --ignore-scripts`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run audit:routing-types`
- `npm run audit:routing-groups`
- `npm run audit:routing-readonly`
- `npm run audit:architecture`
- `npm run audit:release`
- `npm run audit:speed`
- `npm run smoke:interactions`
- `npm run check`
- `git diff --check`

## Artifact
- Source checkpoint: no installer built for this checkpoint.
- SHA-256: Source-only
