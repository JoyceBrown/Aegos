# Aegos 3.5.75

## Scope

- Added `STATUS_SNAPSHOT_CONTRACT_3.5.75.md` to define backend-owned status truth and frontend-owned presentation.
- Extended `audit:status-vocabulary` to require the snapshot contract and verify key status consumers.
- Added backend coverage for stale network availability so old outbound IP results are not treated as freshly verified.

## User Impact

- Sidebar, home status, settings, diagnostics, and the connection button now have a written contract for reading the same runtime facts.
- Future UI changes have a stronger guard against showing "connected" or "available" from local guesses.

## Verification

- Passed: `node -c src/app.js`
- Passed: `cargo fmt --check --manifest-path src-tauri/Cargo.toml`
- Passed: `cargo test --manifest-path src-tauri/Cargo.toml network_availability -- --nocapture`
- Passed: `npm run audit:status-vocabulary`
- Passed: `npm run audit:release`
- Passed: `git diff --check`

## Artifact

- Source-only checkpoint: no installer was built for 3.5.75.
- SHA-256: Source-only / not applicable.
