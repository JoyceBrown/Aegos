# Aegos 3.2.1

Source checkpoint for the read-only routing rule parser.

## Changes
- Added a backend parser that reads the active profile `rules` list and exposes
  structured rule records: type, condition, target, options, status, and note.
- Kept the routing surface read-only: no rule editing, config writes, hot reload,
  proxy switching, or speed-test side effects were added.
- Updated the routing page rule table to render structured rules through safe
  text-node helpers.
- Added `audit:routing-rules` and parser unit coverage for common rules,
  `no-resolve` options, and nested logical rules.
- Bumped package, Tauri, Cargo, and sidebar versions to 3.2.1.

## Verification
- `npm install --package-lock-only --ignore-scripts`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml routing_rule_parser_structures_common_rules`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run audit:routing-rules`
- `npm run audit:release`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `git diff --check`

## Artifact
- Source checkpoint: no installer built for this checkpoint.
- SHA-256: Source-only
