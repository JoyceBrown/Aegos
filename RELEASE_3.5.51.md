# Aegos 3.5.51

Source-only core runtime extraction checkpoint.

No installer was produced for this patch.

## Changed

- Moved Windows system proxy snapshot shape into `core_runtime::SystemProxySnapshot`.
- Moved system proxy endpoint matching into `core_runtime::system_proxy_snapshot_points_to_aegos`.
- Added `core_runtime::should_capture_system_proxy_snapshot` so Aegos owns the rule for when to preserve a pre-existing Windows proxy state.
- Kept Windows registry reads/writes and PowerShell execution in `main.rs`; this patch only moves pure data and policy.
- Updated backend, release, takeover, and core-runtime audits so snapshot policy cannot drift back into `main.rs`.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
- `npm run audit:core-runtime`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run audit:security`
- `npm run audit:speed`
- `npm run audit:stability`
- `npm run audit:architecture`
- `npm run audit:debt`
- `npm run audit:takeover`
- `npm run smoke:interactions`
- `git diff --check`

## Artifact

- Source-only: no installer hash.
- SHA-256: source-only/no-installer.
