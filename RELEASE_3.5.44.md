# Aegos 3.5.44

Source-only architecture checkpoint. No installer was produced for this patch.

## Subscription Runtime

- No UI behavior changed.
- No subscription import, update, switch, or parser behavior changed.
- Added `subscription_runtime` as the subscription source data and diagnostics boundary.
- Moved `ProfileSource`, `ProfileSourceSummary`, subscription diagnostic copy, and source summary counting out of `main.rs`.
- Kept protocol URI parsing and import/update transactions in `main.rs` for the next extraction wave.

## Guardrails

- Added `npm run audit:subscription-runtime`.
- Updated release and subscription diagnostics audits so subscription source data cannot drift back into `main.rs`.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
- `npm run audit:subscription-runtime`
- `npm run audit:subscription`
- `npm run audit:release`
- `npm run audit:backend`
- `npm run audit:architecture`
- `npm run audit:debt`
- `npm run audit:security`
- `npm run audit:speed`
- `npm run audit:core-runtime`
- `npm run audit:stability`
- `npm run audit:diagnostics`
- `npm run audit:diagnostics-product`
- `npm run smoke:interactions`
- `git diff --check`

## Artifact

- Source-only: no installer hash.
- SHA-256: source-only/no-installer.
