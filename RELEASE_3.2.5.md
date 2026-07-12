# Aegos 3.2.5

Source checkpoint for routing hot-reload preflight contract.

## Changes
- Added a read-only `routing_reload_preflight` command that checks a profile's
  rule validation and runtime preflight without writing config files or reloading
  the core.
- Added a structured hot-reload contract with explicit preflight steps,
  `writesConfig: false`, `requiresRollbackPlan: true`, and rollback strategy
  metadata.
- Kept rule editing disabled: no rule mutation command, no config write, no node
  switching, and no speed-test behavior changes.
- Added `audit:routing-reload-preflight` and unit coverage for the read-only,
  rollback-aware contract.
- Bumped package, Tauri, Cargo, and sidebar versions to 3.2.5.

## Verification
- `npm install --package-lock-only --ignore-scripts`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml routing_reload_preflight_contract_is_readonly_and_rollback_aware`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run audit:routing-rules`
- `npm run audit:routing-targets`
- `npm run audit:routing-order`
- `npm run audit:routing-profile-switch`
- `npm run audit:routing-reload-preflight`
- `npm run audit:release`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `git diff --check`

## Artifact
- Source checkpoint: no installer built for this checkpoint.
- SHA-256: Source-only
