# Aegos 3.5.50

Source-only core runtime extraction checkpoint.

No installer was produced for this patch.

## Changed

- Added `core_runtime::CoreTrafficTakeoverPlan` to own post-ready traffic takeover policy.
- Kept Windows system proxy execution in `main.rs`, but moved the decision rules for TUN, startup proxy preference, and final takeover truth into `core_runtime`.
- Preserved the important TUN-off behavior: Aegos must try system proxy takeover, and if that fails it must not report traffic as taken over.
- Added audit coverage so traffic takeover policy does not drift back into scattered `main.rs` conditionals.

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
- `npm run smoke:interactions`
- `git diff --check`

## Artifact

- Source-only: no installer hash.
- SHA-256: source-only/no-installer.
