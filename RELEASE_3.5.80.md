# Aegos 3.5.80

## Scope

- Hardened temporary firewall rules used by speed tests while disconnect protection is enabled.
- Added verification for speed-test allow rule creation, cleanup, and marker removal.
- Replaced mojibake speed-test protection errors with structured failure reasons.
- Extended takeover/speed closure audits so firewall cleanup cannot silently regress.

## User Impact

- Speed tests under disconnect protection should fail with a readable reason instead of leaving confusing garbled logs.
- Temporary firewall exceptions are now checked during both open and cleanup paths.

## Verification

- Passed: `cargo fmt --check --manifest-path src-tauri/Cargo.toml`
- Passed: `npm run audit:takeover`
- Passed: `npm run audit:speed`
- Passed: `npm run audit:release`
- Passed: `git diff --check`

## Artifact

- Source-only checkpoint: no installer was built for 3.5.80.
- SHA-256: Source-only / not applicable.
