# Aegos 3.5.3

## Summary

- Source-only checkpoint for the third CoreRuntime/CoreAdapter foundation step.
- Moves runtime config apply into `CoreRuntimeApplyTransaction`, including `/configs?force=true` payload construction, timeout policy, and controller version verification.
- Keeps process-aware readiness checks in `CoreManager`, where child-process exit state can be observed.
- Extends core, backend, and release audits so direct `/configs?force=true` calls from `main.rs` are rejected.

## Artifact

- Type: Source-only checkpoint; no installer generated.
- SHA-256: Source-only checkpoint; no installer generated.
- Previous test installer remains `src-tauri/target/release/bundle/nsis/Aegos_3.5.0_x64-setup.exe`.

## Verification

- `npm run check`
- `npm run audit:core-runtime`
- `npm run audit:backend`
- `npm run audit:debt`
- `npm run audit:security`
- `npm run audit:architecture`
- `npm run audit:release`
- `npm run smoke:interactions`

## Remaining Risk

- Profile source parsing, rendered profile creation, profile-file patching, standby speed-test preparation, and runtime state rollback still live inside `main.rs`.
- The next extraction should make runtime preparation return a typed artifact for active and standby paths, then move profile-file patching into a config compiler boundary.
- Aegos still controls mihomo through its controller API. This checkpoint narrows and audits that control path; it does not yet embed or fork mihomo internals.
