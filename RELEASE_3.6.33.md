# Aegos 3.6.33

Speed-test architecture reform, Aegos core-domain ownership, and the seven-stage rule-system closure for Windows x64.

## Implemented

- Replaced per-node operating-system threads with a bounded reusable worker scheduler.
- Added protocol-family concurrency limits and adaptive fast/refinement worker policies.
- Split batch testing into a fast visible pass and a lower-concurrency background refinement pass.
- Added profile/run generation cancellation so old subscription results cannot write into the active subscription.
- Kept speed testing measurement-only: it does not connect, change mode, select a node, enable system proxy, or enable TUN.
- Removed broad temporary speed-test firewall port windows and reused verified Aegos/core program rules under disconnect protection.
- Added post-paint runtime preparation and a profile/config-keyed target catalog to reduce cold first-test delay.
- Added per-profile speed-health persistence with confined Windows atomic replacement and serialized read/modify/write.
- Replaced full-result polling with per-node events, an O(1) dynamic overlay, 64-item frame chunks, and a queue-aware watchdog.
- Made single-node speed tests event-first with a bounded polling fallback.
- Added speed phases, timing, revision signatures, structured failure reasons, and fast/final terminal events.
- Added Aegos-owned typed controller contracts for traffic, connections, proxy groups, delay probes, and runtime version receipts.
- Added the unified `ProxyCatalog` model for default groups, nested-group resolution, selected state, fixed-node metadata, and speed-health enrichment.
- Removed the controller-to-JSON-to-catalog round trip; running and offline node sources now converge on the same Aegos product model.
- Made mode and node selection transactional: runtime apply precedes preference commit, and save failures restore the previous runtime state.
- Added boundary tests proving unknown controller fields, node passwords, and raw history cannot reach product snapshots.

## Rule-System Closure

- User rules live in the independent, atomic `aegos-user-rules.json` store with stable IDs and explicit all-subscription/current-subscription scope.
- Subscription deletion previews affected rules and retains scoped rules as inactive, rebindable records.
- Missing targets remain in the user store but are omitted from runtime candidates instead of silently rerouting traffic.
- Website, application, and common-service wizards feed one typed rule model; system protection rules remain read-only.
- The runtime order is deterministic: protected Aegos checks, explicit user rules, user scene rules, subscription rules, then fallback.
- Same-scope duplicate matchers are rejected, profile-specific rules precede overlapping global rules, and non-overridable system rules explain why.
- Rule-store changes use candidate staging, runtime verification, rollback, crash-recovery journals, undo snapshots, and persistent deployment reports.
- Large subscription rule sets use backend pagination; website tests use a targeted read-only query and never change configuration or node selection.
- Initial rule-page payload is bounded to 80 subscription rules, and stale page/test responses are discarded after subscription changes.

## Measured Evidence

- Deterministic pressure fixture: 8,000 nodes in 400-result bursts.
- Result delivery: 8,000 / 8,000.
- Healthy event-path full snapshots: 0.
- Result stream duration: 887.6 ms in the final standalone pressure run.
- Three-run result-stream frame P95: 50.0 / 50.0 / 33.4 ms; worst frame: 83.3 ms.
- Realistic navigation frame P95: 16.8 ms; layout shift: 0.
- Startup status: 151.4 ms; first home nodes: 229.9 ms.
- Native rule-page fixture: 4,276 rules; first content 301.6 ms; navigation P95 37.4 ms; node render max 4.3 ms.

## Verification

- The carried `3.5.71 - 3.6.40` mainline was rechecked with `npm run audit:current-mainline`.
- Rust was checked with `cargo check --manifest-path src-tauri/Cargo.toml` and tested with 157 passing tests, 0 failures.
- UI smoke passed 12 viewport/DPI combinations with populated home and node lists, no horizontal overflow, and no detected overlap.
- Stage 1 status vocabulary, Stage 2 non-blocking interaction, every Stage 3 sub-gate, and the seven-stage rule closure passed.
- Config deployment, responsiveness, security, runtime regression, interaction, native performance, installer, and release gates passed before packaging.
- Stage 2 closure: `npm run audit:stage2-closure`, `npm run audit:runtime-regression`, `npm run audit:takeover`, `npm run audit:installer-regression`, `npm run audit:stability`, and `npm run audit:core-runtime`.
- The 3.5.86 pressure path was rerun with `npm run smoke:interactions`, `npm run smoke:perf`, and `npm run audit:phase2-pressure`.
- 3.5.87 rule-page definition: `npm run audit:stage3-rules-page`.
- 3.5.88 website wizard: `npm run audit:stage3-website-rules`.
- 3.5.89 application wizard: `npm run audit:stage3-app-rules`.
- 3.5.90 strategy selector: `npm run audit:stage3-strategy-selector`.
- 3.5.91 conflict explanation uses "用户规则优先": `npm run audit:stage3-conflict-explanation`.
- 3.5.92 rule preview keeps "用户规则优先" visible: `npm run audit:stage3-rule-preview`.
- 3.5.93 pre-apply checks explain "目标不存在": `npm run audit:stage3-preapply-check`.
- 3.5.95 规则列表可管理: `npm run audit:stage3-rule-list-management`.
- 3.5.96 系统规则解释: `npm run audit:stage3-system-rules`.
- 3.5.97 节点页和规则页联动: `npm run audit:stage3-node-rule-link`.
- 3.5.98 规则测试按钮: `npm run audit:stage3-rule-test`.
- 3.5.99 historical gate and UX polish gates: `npm run audit:stage3-ux-polish`.
- Rule closure gates include `npm run audit:routing-seven-stage`, `npm run audit:routing-product`, and `npm run audit:stage3-acceptance`.
- Final product gates include `npm run smoke:ui`, `npm run smoke:perf:native`, and `npm run audit:release`.

## Limits

- Synthetic tests prove scheduling, cancellation, rendering, state isolation, and rollback behavior, but cannot reproduce every live provider policy or route.
- Final SS, Trojan, VLESS, TUIC, AnyTLS, and Hysteria2 success rates still require testing against the user's real subscriptions and network.
- Cached delay results are display history only and never count as a new speed-test success.

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.33_x64-setup.exe`
- Size: `16,098,995` bytes
- SHA-256: `FF8AB81F71709FF6517296244956A4177E5B2AE95BEFE9253A0CF6BFB05275EE`
