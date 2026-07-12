# Aegos 3.2.7

Source checkpoint for routing diagnostics report.

## Changes
- Added a read-only `routing_diagnostics_report` command that composes rule
  validation, runtime reload preflight, and rollback plan into one report.
- Added structured report severity, summary counts, rule/runtime/rollback
  sections, and suggested next actions for future editable routing.
- Kept routing edits disabled: no rule mutation command, no config write, no
  hot reload, no node switching, and no speed-test behavior changes.
- Added `audit:routing-diagnostics` and unit coverage for report severity.
- Bumped package, Tauri, Cargo, and sidebar versions to 3.2.7.

## Verification
- `npm install --package-lock-only --ignore-scripts`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml routing_diagnostics_report_escalates_rule_and_runtime_findings`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run audit:routing-rules`
- `npm run audit:routing-targets`
- `npm run audit:routing-order`
- `npm run audit:routing-profile-switch`
- `npm run audit:routing-reload-preflight`
- `npm run audit:routing-rollback`
- `npm run audit:routing-diagnostics`
- `npm run audit:release`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `git diff --check`

## Artifact
- Source checkpoint: no installer built for this checkpoint.
- SHA-256: Source-only
