# Aegos 3.5.71

## Scope

- Established `STATUS_VOCABULARY_3.5.71.md` as the user-facing status vocabulary checkpoint.
- Added shared frontend status helpers: `STATUS_TEXT`, `enabledLabel`, `systemProxyUiLabel`, and `runtimeSummaryLabel`.
- Routed home/settings status labels through the shared helpers.
- Cleaned abnormal Unicode/mojibake fragments from visible frontend copy touched by this checkpoint.
- Added `audit:status-vocabulary` and wired it into release auditing.

## User Impact

- Home and settings now use consistent words for connected, standby, takeover, system proxy, TUN, protection, and environment states.
- Environment check failure now reports failure instead of saying the check is still running.
- Diagnostics/routing/subscription notices no longer contain broken visible text from historical encoding damage.

## Verification

- Passed: `node -c src/app.js`
- Passed: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- Passed: `npm run audit:status-vocabulary`
- Passed: `npm run check`
- Passed: `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture` (97 tests)
- Passed: `npm run audit:release`
- Passed: `npm run audit:security`
- Passed: `npm run audit:architecture`
- Passed: `npm run audit:core-runtime`
- Passed: `npm run audit:backend`
- Passed: `npm run audit:copy`
- Passed: `npm run audit:speed`
- Passed: `npm run audit:stability`
- Passed: `npm run audit:debt`
- Passed: `npm run audit:takeover`
- Passed: `npm run audit:responsiveness`
- Passed: `npm run audit:global-interaction-product`
- Passed: `npm run smoke:interactions`
- Passed: `git diff --check`

## Artifact

- Source-only checkpoint: no installer was built for 3.5.71.
- SHA-256: Source-only / not applicable.

## Remaining Work

- 3.5.72 should separate "software runtime state" from "network is actually usable" in the status surface.
- Backend `connection_phase` still returns English neutral labels; frontend vocabulary now owns user-facing Chinese terms for this checkpoint.
