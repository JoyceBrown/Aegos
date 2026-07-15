# Aegos 3.5.81

## Scope

- Added a backend generation guard for outbound IP refreshes.
- Prevented stale outbound IP query results from overwriting the cache after node/profile changes.
- Replaced outbound IP lookup mojibake errors with readable structured messages.
- Added backend audit coverage for stale outbound IP result handling.

## User Impact

- Switching nodes while an outbound IP lookup is still running should no longer leave the UI or backend cache stuck on the previous node's IP.
- Outbound IP failures now produce readable reasons instead of garbled text.

## Verification

- Passed: `cargo fmt --check --manifest-path src-tauri/Cargo.toml`
- Passed: `cargo check --manifest-path src-tauri/Cargo.toml`
- Passed: `npm run audit:backend`
- Passed: `npm run audit:release`
- Passed: `git diff --check`

## Artifact

- Source-only checkpoint: no installer was built for 3.5.81.
- SHA-256: Source-only / not applicable.
