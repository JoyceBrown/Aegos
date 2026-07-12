# Aegos 3.2.3

Source checkpoint for read-only routing rule order and conflict detection.

## Changes
- Added read-only rule order analysis for duplicate rules, same matcher with
  conflicting targets, and rules placed after `MATCH`.
- Added `orderIssue` metadata on affected rule records and exposed
  `ruleOrderIssues` in the routing snapshot summary.
- Displayed order issue details in the existing routing rule table without
  adding editing controls or changing layout density.
- Kept the routing foundation read-only with no config writes, hot reload, rule
  mutation, node switching, or speed-test side effects.
- Added `audit:routing-order` and unit coverage for duplicate, conflicting, and
  unreachable rule cases.
- Bumped package, Tauri, Cargo, and sidebar versions to 3.2.3.

## Verification
- `npm install --package-lock-only --ignore-scripts`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml routing_rule_order_detection_reports_duplicates_conflicts_and_unreachable`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run audit:routing-rules`
- `npm run audit:routing-targets`
- `npm run audit:routing-order`
- `npm run audit:release`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `git diff --check`

## Artifact
- Source checkpoint: no installer built for this checkpoint.
- SHA-256: Source-only
