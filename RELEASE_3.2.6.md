# Aegos 3.2.6

Source checkpoint for routing rollback foundation.

## Changes
- Added a read-only `routing_rollback_plan` command that captures the active
  profile digest, runtime profile digest, runtime identity, traffic takeover
  flag, and selected proxy map size.
- Added a structured rollback contract with `writesConfig: false`,
  `requiresAtomicRestore: true`, path confinement policy, and explicit restore
  sequence.
- Kept routing edits disabled: no rule mutation command, no config write, no
  hot reload, no node switching, and no speed-test behavior changes.
- Added `audit:routing-rollback` and unit coverage for the read-only rollback
  plan.
- Bumped package, Tauri, Cargo, and sidebar versions to 3.2.6.

## Verification
- `npm install --package-lock-only --ignore-scripts`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml routing_rollback_plan_tracks_restore_contract_without_writes`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run audit:routing-rules`
- `npm run audit:routing-targets`
- `npm run audit:routing-order`
- `npm run audit:routing-profile-switch`
- `npm run audit:routing-reload-preflight`
- `npm run audit:routing-rollback`
- `npm run audit:release`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `git diff --check`

## Artifact
- Source checkpoint: no installer built for this checkpoint.
- SHA-256: Source-only
