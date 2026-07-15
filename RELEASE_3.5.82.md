# Aegos 3.5.82

## Scope

- Added diagnostic action matrix metadata to group failed checks by category.
- Expanded log/report redaction to cover Windows local paths and private/CGNAT IPv4 addresses.
- Replaced mojibake profile preflight diagnostics with readable messages.
- Extended diagnostics and security audits to guard the new redaction and action-matrix contract.

## User Impact

- Diagnostic reports now carry clearer action grouping for support and future UI surfaces.
- Exported logs and diagnostic reports mask more local machine details by default.
- Profile preflight failures should no longer show garbled text.

## Verification

- Passed: `cargo fmt --check --manifest-path src-tauri/Cargo.toml`
- Passed: `cargo test --manifest-path src-tauri/Cargo.toml log_sanitizer_redacts_subscription_and_node_secrets -- --nocapture`
- Passed: `cargo test --manifest-path src-tauri/Cargo.toml diagnostic_check_and_summary_are_runtime_shaped -- --nocapture`
- Passed: `npm run audit:diagnostics`
- Passed: `npm run audit:security`
- Passed: `npm run audit:release`
- Passed: `git diff --check`

## Artifact

- Source-only checkpoint: no installer was built for 3.5.82.
- SHA-256: Source-only / not applicable.
