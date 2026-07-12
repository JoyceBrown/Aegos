# Aegos 3.2.2

Source checkpoint for read-only routing rule target validation.

## Changes
- Added a target catalog for active profile rules using proxy groups, proxy names,
  and built-in policy targets such as `DIRECT`, `REJECT`, `PASS`, and `GLOBAL`.
- Marked parsed routing rules with `targetExists`, `targetKind`, and
  `missing-target` status when the rule points to a missing profile target.
- Exposed `missingRuleTargets` in the routing snapshot summary for later
  diagnostics and rule foundation work.
- Kept the routing page read-only with no rule mutation, config writes, hot
  reload, node switching, or speed-test side effects.
- Added `audit:routing-targets` and unit coverage for valid groups, missing
  groups, and built-in targets.
- Bumped package, Tauri, Cargo, and sidebar versions to 3.2.2.

## Verification
- `npm install --package-lock-only --ignore-scripts`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml routing_rule_target_validation_reports_missing_targets`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run audit:routing-rules`
- `npm run audit:routing-targets`
- `npm run audit:release`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `git diff --check`

## Artifact
- Source checkpoint: no installer built for this checkpoint.
- SHA-256: Source-only
