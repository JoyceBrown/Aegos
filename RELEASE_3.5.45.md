# Aegos 3.5.45

Source-only architecture checkpoint. No installer was produced for this patch.

## Subscription Runtime

- No UI behavior changed.
- No subscription import, update, switch, or protocol parsing behavior changed.
- Moved subscription input normalization into `subscription_runtime`:
  - airport metadata/comment filtering,
  - BOM and base64 wrapper decoding,
  - unsupported URI scheme detection,
  - Clash/Mihomo YAML coarse detection.
- Kept small compatibility wrappers in `main.rs`; later checkpoints can move callers directly to the runtime module.

## Guardrails

- Expanded `npm run audit:subscription-runtime` to lock the input normalization boundary.
- Updated subscription diagnostics audit so BOM/base64 and airport metadata checks follow the new owner module.

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
- `npm run smoke:interactions`
- `git diff --check`

## Artifact

- Source-only: no installer hash.
- SHA-256: source-only/no-installer.
