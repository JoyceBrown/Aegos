# Aegos 3.6.8

Stage 4 completion checkpoint: safe configuration deployment.

## Mainline

- Current mainline: 3.5.71 - 3.6.40.
- Stage 1 status truth, Stage 2 responsive operations, Stage 3 ordinary-user routing, and Stage 4 safe deployment are carried forward into this installer checkpoint.
- Stage 2 carry-forward item: 3.5.86 continuous operation pressure test.

## Stage 4 Gates

- 3.6.1: every deployment has a plan and explicit operation identity.
- 3.6.2: candidate config is staged before active config replacement.
- 3.6.3: static profile and target validation run before promotion.
- 3.6.4: runtime preflight rejects a configuration Mihomo cannot accept.
- 3.6.5: hot reload verifies controller readiness and runtime identity.
- 3.6.6: rollback restores the last known configuration; startup recovers interrupted promoted deployments.
- 3.6.7: deployment reports record operation, digests, state, and recovery detail without subscription secrets.
- 3.6.8: candidate, promotion, rollback, crash recovery, and writer integration are audited together.

## Writers Covered

- Subscription import and update.
- Fixed-node settings.
- Website and application rule apply, edit, delete, reorder, and undo.
- Routing strategy-group changes.

## Verification

- Passed: `npm run audit:current-mainline`
- Passed: `npm run audit:status-vocabulary`
- Passed: `npm run audit:phase2-pressure`
- Passed: `npm run audit:stage2-closure`
- Passed: `npm run audit:runtime-regression`
- Passed: `npm run audit:installer-regression`
- Passed: `npm run audit:stability`
- Passed: `npm run audit:core-runtime`
- Passed: `npm run audit:takeover`
- Passed: `npm run audit:stage3-acceptance`
- Passed: `npm run audit:config-deployment`
- Passed: `npm run smoke:interactions`
- Passed: `npm run smoke:perf`
- Passed: `cargo test --manifest-path src-tauri/Cargo.toml config_deployment`
- Passed: `cargo check --manifest-path src-tauri/Cargo.toml`
- Passed: `npm run audit:release`
- Passed: `npm run build`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.8_x64-setup.exe`
- SHA-256: 3969167d67dfe9116b18dc5eb6dfa9ba8027417647e052f1b0f181204270ed91

## Remaining Risk

- Windows system takeover is intentionally deferred to Stage 5. Configuration deployment preserves the current core/takeover state but does not broaden firewall or TUN behavior in this release.
