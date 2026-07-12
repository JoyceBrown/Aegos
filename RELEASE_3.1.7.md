# Aegos 3.1.7

Installer checkpoint for read-only routing page acceptance.

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
- `npm run build`
- `npm run audit:installer`
- `git diff --check`

## Artifact
- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.1.7_x64-setup.exe`
- Size: 15,409,243 bytes
- SHA-256: D57F43C2531C462C86DC81AD0B49BBE1C9E801C6712223D98462B6C5095187F5
