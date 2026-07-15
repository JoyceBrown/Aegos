# Aegos 3.5.53

Source-only core-runtime consolidation checkpoint. No installer was built for this small internal step.

## Changed

- Moved Windows system proxy takeover planning into `core_runtime`.
- Centralized the local proxy server address and LAN bypass list used by Windows proxy takeover.
- Kept registry writes and WinInet refresh inside `main.rs`; user-visible connection behavior is unchanged.
- Extended core-runtime, takeover, and release audits so system proxy policy cannot drift back into ad-hoc script builders.

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

- Source-only checkpoint.
- SHA-256: Source-only, no installer artifact for this internal runtime-boundary step.
