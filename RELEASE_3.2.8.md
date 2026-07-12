# Aegos 3.2.8

Source checkpoint for routing foundation acceptance.

## Changes
- Added a read-only `routing_foundation_acceptance` command that documents the
  3.2 routing foundation gate.
- Added explicit acceptance coverage for rule parsing, target validation, order
  detection, profile-switch validation, reload preflight, rollback planning, and
  diagnostics report.
- Kept routing edits disabled: no rule mutation command, no config write, no
  hot reload, no node switching, and no speed-test behavior changes.
- Added `audit:routing-foundation` and unit coverage that keeps editable routing
  disabled until the next design gate.
- Bumped package, Tauri, Cargo, and sidebar versions to 3.2.8.

## Verification
- `npm install --package-lock-only --ignore-scripts`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml routing_foundation_acceptance_keeps_editing_disabled_until_gates_pass`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run audit:routing-rules`
- `npm run audit:routing-targets`
- `npm run audit:routing-order`
- `npm run audit:routing-profile-switch`
- `npm run audit:routing-reload-preflight`
- `npm run audit:routing-rollback`
- `npm run audit:routing-diagnostics`
- `npm run audit:routing-foundation`
- `npm run audit:release`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `git diff --check`

## Artifact
- Source checkpoint: no installer built for this checkpoint.
- SHA-256: Source-only
