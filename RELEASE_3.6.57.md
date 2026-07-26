# Aegos 3.6.57

## Scope

- Make rule testing a first-class Rules workspace beside Website, Application,
  and System.
- Repair the generated-rule detail disclosure at normal and minimum window
  sizes.
- Add FlClash-style additional rules and controlled YAML override support
  without surrendering Aegos runtime ownership or executing arbitrary scripts.

## Changes

- Renamed "Test existing rules" to "Test" and moved it into the same vertical
  task selector as Website, Application, and System.
- Rule testing keeps the existing hit explanation while avoiding an extra
  nested panel.
- Generated-rule details now use one explicit Expand/Collapse label source.
  The expanded content is width-bounded and scrolls internally, so the
  collapse action stays visible.
- Settings adds a focused Configuration Extensions category:
  - Additional rules accept one Mihomo rule per line, deduplicate entries, and
    insert them before the terminal MATCH/FINAL fallback.
  - YAML override recursively merges supported configuration keys; `null`
    removes a key.
  - Aegos-owned ports, controller credentials, takeover, TUN, DNS, and rules
    remain protected.
  - YAML tags, oversized input, excessive nesting, excessive node counts, and
    additional MATCH/FINAL rules are rejected before runtime deployment.
- Configuration Extensions keeps its status, Clear, and Validate and Save
  actions beside the workspace title. The editor area now owns a bounded
  vertical scroll surface, and the action header remains visible at the
  production minimum window size.
- Extension changes use the existing background settings transaction,
  preflight, runtime deployment, and rollback path. Subscription sources are
  never rewritten.
- Diagnostics expose only extension counts and enabled/configured state, never
  the user's rule or override contents.
- Rule details now expand below the active Website/Application form instead of
  overlapping its scope selector and draft action at compact window heights.
- System readiness and IPv6/DNS checks run on blocking workers; the network
  conflict probe has a five-second ceiling, so settings navigation remains
  responsive while a check is running.
- Automatic DNS now favors direct encrypted resolvers for ordinary
  subscription nodes. Selecting the active fixed node switches to remote
  encrypted DNS through the same Aegos landing route and forces TUN DNS
  interception to prevent local resolver leakage.
- The DNS settings category now reports the effective runtime route and
  protection state instead of only echoing saved preferences. Ordinary nodes,
  fixed nodes with TUN protection, fixed nodes still needing TUN, and the
  disconnected ready state each have explicit user-facing status.
- Switching across the ordinary-node/fixed-node boundary hot-reloads the
  runtime DNS route immediately. A failed reload restores the previous
  selection, settings, and runtime configuration.
- Under a fixed node with TUN, the DNS interception switch reflects the
  enforced runtime state and explains that Aegos is managing it automatically.
- IPv6/DNS status rendering now mounts only in the DNS settings panel and
  verifies every target element before updating it, removing the null
  `textContent` exception.

## Verification

- 195 Rust unit tests passed.
- The DNS category was verified in an isolated `Aegos Validation` instance at
  the production 920x640 minimum window size. Status, interception, DNS mode,
  and save controls remained fully visible without clipping.
- The application remained navigable while the real system check was running;
  switching to the DNS category completed in about 0.84 seconds.
- Mihomo accepted both the routed fixed-node DNS group and the ordinary-node
  `#DIRECT` encrypted DNS configuration.
- Configuration extension, routing rule test, routing product, interaction,
  UI, responsiveness, settings security, architecture, Stage 7 visual, and
  release gates passed.
- The complete product smoke passed all ten ordinary-user journeys with zero
  forbidden side effects: `npm run smoke:product`.
- The 800-node pressure run completed 420 rapid page changes with 0.30ms
  navigation P95. Cold routing content was ready in 222.3ms.
- Three repeated cold runs kept Cold routing at or below 220.9ms.
- Windowed GPU navigation stayed at 33.5ms P95 and 66.7ms maximum on the
  current 30Hz compositor.
- The 16-cycle soak completed 277 mixed commands with stable DOM and timer
  counts.
- Performance evidence passed `npm run audit:stage8-performance`.
- Mainline evidence for `3.5.71 - 3.6.40` passed
  `npm run audit:current-mainline` and
  `cargo check --manifest-path src-tauri/Cargo.toml`.
- Pressure coverage retains the 3.5.86 checkpoint through
  `npm run smoke:interactions`, `npm run smoke:perf`, and
  `npm run audit:phase2-pressure`.
- Historical Stage 3 behavior remains covered by the 3.5.95
  "规则列表可管理", 3.5.96 "系统规则解释", 3.5.97 node-rule link, and
  3.5.99 historical gate / UX polish gates. The product keeps "用户规则优先"
  and reports "目标不存在" before apply.
- Stage 3 gates:
  `npm run audit:stage3-rules-page`,
  `npm run audit:stage3-website-rules`,
  `npm run audit:stage3-app-rules`,
  `npm run audit:stage3-strategy-selector`,
  `npm run audit:stage3-conflict-explanation`,
  `npm run audit:stage3-rule-preview`,
  `npm run audit:stage3-preapply-check`,
  `npm run audit:stage3-rule-list-management`,
  `npm run audit:stage3-system-rules`,
  `npm run audit:stage3-node-rule-link`, and
  `npm run audit:stage3-ux-polish`.
- FlClash was not stopped, restarted, or modified.

## Evidence

- `PERFORMANCE_PRESSURE_3.6.57.json`
- `PERFORMANCE_GPU_3.6.57.json`
- `PERFORMANCE_REPEAT_3.6.57.json`
- `PERFORMANCE_SOAK_3.6.57.json`
- `PRODUCT_SMOKE_3.6.57.json`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.57_x64-setup.exe`
- Size: `16253931` bytes
- SHA-256: `ea13ddd544ed50e7f6664824e0b2ff769fe8bfced1c330b82a021db445904d73`
- Signature: unsigned open-source build

## Known Limits

- Real airport connectivity is not simulated by deterministic test fixtures.
  Existing user validation remains the real-network acceptance source.
- The override editor intentionally accepts controlled YAML rather than
  arbitrary JavaScript. This prevents configuration scripts from escaping the
  product's validation, ownership, and rollback boundaries.
- The installer is not Authenticode-signed, so Windows may show a reputation
  warning until a trusted signing certificate is configured.
- Real-device long-duration stability is not a release blocker on the current
  resource-constrained host; deterministic pressure, repeat, Windowed GPU,
  soak, and product-journey gates remain mandatory.
