# Aegos 3.1.3

Source checkpoint for separating routing strategy groups from ordinary node
lists.

## Changes
- Added `audit:routing-groups` to verify routing data is displayed as strategy
  groups, not ordinary selectable or measurable nodes.
- Clarified the routing group table copy so the UI does not imply strategy
  groups are proxy nodes.
- Kept node list and speed-test filters guarded against proxy-group references.
- Kept routing read-only with no rule editing or config writes.
- Bumped package, Tauri, Cargo, and sidebar versions to 3.1.3.

## Verification
- `npm install --package-lock-only --ignore-scripts`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run audit:routing-groups`
- `npm run audit:routing-mode`
- `npm run audit:routing-readonly`
- `npm run audit:routing-navigation`
- `npm run audit:architecture`
- `npm run audit:release`
- `npm run audit:speed`
- `npm run smoke:interactions`
- `npm run check`
- `git diff --check`

## Artifact
- Source checkpoint: no installer built for this checkpoint.
- SHA-256: Source-only
