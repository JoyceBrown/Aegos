# Aegos 3.2.4

Source checkpoint for profile-switch routing rule validation.

## Changes
- Added a reusable routing validation summary for a single profile, covering
  rule count, missing targets, order issues, warning count, and parse errors.
- Ran rule validation before activating a profile in `set_active_profile` and
  logged pass/warning results without mutating user rules.
- Added a read-only `profile_rule_validation` command for future subscription UI
  warnings and diagnostics.
- Kept validation out of the status heartbeat to avoid slowing normal UI refresh.
- Added `audit:routing-profile-switch` and unit coverage for profile switch
  warning summaries.
- Bumped package, Tauri, Cargo, and sidebar versions to 3.2.4.

## Verification
- `npm install --package-lock-only --ignore-scripts`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml profile_rule_validation_summary_counts_switch_warnings`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run audit:routing-rules`
- `npm run audit:routing-targets`
- `npm run audit:routing-order`
- `npm run audit:routing-profile-switch`
- `npm run audit:release`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `git diff --check`

## Artifact
- Source checkpoint: no installer built for this checkpoint.
- SHA-256: Source-only
