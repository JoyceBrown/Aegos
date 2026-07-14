# Aegos 3.5.1

## Summary

- Source-only checkpoint for the first CoreRuntime/CoreAdapter foundation after the 3.5.0 core upgrade.
- Introduces a dedicated `core_runtime` module for the managed mihomo dataplane identity, controller access, and launch plan.
- Routes mihomo controller operations through `CoreController` and process startup through `CoreLaunchPlan` so later work can add stricter runtime policy without scattered launch/controller code.
- Extends the core runtime audit so release gates reject direct controller client rebuilds and direct dataplane process launch bypasses.

## Artifact

- Type: Source-only checkpoint; no installer generated.
- SHA-256: Source-only checkpoint; no installer generated.
- Previous test installer remains `src-tauri/target/release/bundle/nsis/Aegos_3.5.0_x64-setup.exe`.

## Verification

- `npm run check`
- `npm run audit:core-runtime`
- `npm run audit:backend`
- `npm run audit:debt`
- `npm run audit:release`

## Remaining Risk

- `src-tauri/src/main.rs` still contains too many responsibilities. The next checkpoints must move runtime config generation, hot reload, standby speed-test preparation, and system takeover transactions behind explicit contracts.
- `src/app.js` still carries historical encoding debt in some user-facing copy. Avoid bulk text rewriting until a controlled encoding cleanup checkpoint.
- 3.5.1 does not claim that mihomo is fully absorbed into Aegos. It establishes the first enforceable adapter boundary.
