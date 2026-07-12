# Aegos 3.1.7

Source checkpoint for read-only routing page acceptance.

## Changes
- Added `audit:routing-acceptance` as the 3.1.x routing acceptance gate.
- Confirmed routing page coverage across read-only boundaries, deferred
  navigation, mode summary, group separation, type labels, current selection
  copy, redaction, performance smoke, and interaction smoke.
- Kept the routing page read-only with no rule editing, config writes, or speed
  test switching behavior.
- Bumped package, Tauri, Cargo, and sidebar versions to 3.1.7.

## Verification
- `npm install --package-lock-only --ignore-scripts`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run audit:routing-acceptance`
- `npm run audit:routing-readonly`
- `npm run audit:routing-navigation`
- `npm run audit:routing-mode`
- `npm run audit:routing-groups`
- `npm run audit:routing-types`
- `npm run audit:routing-selection`
- `npm run audit:routing-redaction`
- `npm run audit:release`
- `npm run audit:security`
- `npm run audit:speed`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run check`
- `git diff --check`

## Artifact
- Source checkpoint: no installer built for this checkpoint.
- SHA-256: Source-only
