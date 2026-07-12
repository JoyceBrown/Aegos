# Aegos 3.1.5

Source checkpoint for current strategy selections and automatic strategy
behavior copy.

## Changes
- Added `audit:routing-selection` to guard current selection display and
  automatic group wording.
- Clarified automatic strategy groups as "automatic strategy, speed test does
  not switch" so speed testing cannot be mistaken for connection switching.
- Kept strategy selection display read-only; no routing config writes were
  added.
- Bumped package, Tauri, Cargo, and sidebar versions to 3.1.5.

## Verification
- `npm install --package-lock-only --ignore-scripts`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run audit:routing-selection`
- `npm run audit:routing-types`
- `npm run audit:routing-groups`
- `npm run audit:routing-readonly`
- `npm run audit:release`
- `npm run audit:speed`
- `npm run smoke:interactions`
- `npm run check`
- `git diff --check`

## Artifact
- Source checkpoint: no installer built for this checkpoint.
- SHA-256: Source-only
