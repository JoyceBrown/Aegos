# WM-03 Import, Selection, And Deployment Evidence

record_kind: evidence_register
execution_authority: none
plan_id: AEGOS-WINDOWS-MATURITY
task_id: WM-03
status: completed
updated_at: 2026-07-26

This register records only WM-03 evidence. It does not authorize another
task; the active plan remains `../../PLANS.md`.

## Test Boundary

The subscription journey uses a request-reading loopback server, sanitized
fixtures, and a test-only direct downloader. Production HTTP and HTTPS proxy
behavior is unchanged. The selection journey uses the approved
`resources/core/mihomo.exe`, a unique temporary Aegos root, and the sanitized
`clash-basic.yaml` fixture. It disables system proxy, startup proxy, TUN, and
kill-switch. It does not stop, restart, configure, or take over FlClash.

The two real managed-core journeys hold a test-only mutex while their child
processes are active. This prevents their local Mihomo listener ports from
colliding under Rust's parallel test runner; it does not serialize production
operations or change runtime port selection.

## Journey Matrix

| Journey | Saved intent | Runtime fact | Windows takeover fact | Connectivity fact | Evidence |
| --- | --- | --- | --- | --- | --- |
| Valid subscription update | Candidate source, digest, and metadata replace the preceding source only after validation. | Parsed source remains usable. | No Windows setting is requested. | Not measured. | `wm03_isolated_remote_update_keeps_previous_source_for_invalid_or_interrupted_results`. |
| Invalid, slow, or stale subscription update | Previous source, digest, and metadata remain intact. | Rejected or stale input cannot replace the active source. | No Windows setting is requested. | Not measured. | Same hermetic loopback journey. |
| Ordinary node selection | `Fixture -> Fixture VLESS` persists only after Controller selection succeeds. | Real managed Mihomo Controller reports `Fixture VLESS`. | Standby only; `trafficTakeover=false`. | Not measured. | `wm03_isolated_selection_and_fixed_nodes_restore_runtime_state_after_failures`. |
| Preference-save failure | The selected map returns to `Fixture VLESS`. | Controller, DNS snapshot, runtime digest, and runtime YAML return to the preceding state. | No Windows mutation. | Not measured. | Same isolated controller journey with an unwritable settings target. |
| Fixed-node selection | `Fixture -> WM03 Fixed` becomes the selected intent. | Controller reports both `Fixture` and `Aegos Landing IP` as `WM03 Fixed`; DNS snapshot reports `fixedNode=true` and routes through the internal group. | Standby only; no DNS, proxy, TUN, firewall, or registry write. | Not measured. | Same isolated controller journey. |
| Fixed-node DNS reload failure | The selected map returns to `Fixture VLESS`. | Controller, DNS policy, runtime digest, and runtime YAML restore the preceding ordinary-node state. | No Windows mutation. | Not measured. | Test-only runtime apply fault injection after candidate write and before Controller apply. |
| Fixed-node save failure | The candidate node is not retained. | The preceding runtime YAML and Controller selection remain active. | No Windows mutation. | Not measured. | Candidate deployment rollback with injected runtime apply failure. |
| Fixed-node delete failure | The deleted node is restored in saved intent. | The preceding runtime YAML and Controller selection remain active. | No Windows mutation. | Not measured. | Candidate deployment rollback with injected runtime apply failure. |

## Defect Register

| ID | Priority | Reproduction | Expected terminal state | Observed state | Resolution and regression target |
| --- | --- | --- | --- | --- | --- |
| WM03-001 | P1, resolved | Select a fixed manual node in a profile with a sole custom `Fixture` group. Runtime normalization adds generic groups for display. | DNS policy and the internal outbound-IP lookup group follow the user-selected `Fixture` leaf. | Generic `GLOBAL`/`Proxies` fallback could outrank the terminal `MATCH,Fixture` route, making fixed DNS state false and allowing the lookup group to choose a default node. | The compiler now derives the primary group from the terminal rule in rule mode, then uses deterministic standard and selected-group fallbacks. Config generation, DNS state, and runtime lookup synchronization use that result. Covered by the custom-group DNS unit test and real Controller assertion. |
| WM03-002 | P1, resolved | Run the WM-01 and WM-03 real Mihomo journeys under the parallel Rust suite. | Both isolated journeys reach Controller readiness. | The journeys could contend for temporary local listener ports; one then timed out before Controller readiness. | A test-only mutex serializes the two real child-process journeys. The production port-selection path is unchanged. Covered by the full 222-test suite. |

## Closure Evidence

- `cargo test --manifest-path src-tauri/Cargo.toml` passed: 222 tests.
- Focused DNS and real managed-core selection journeys passed, including the
  Controller assertions and all injected rollback cases above.
- `npm run smoke:interactions` and `npm run smoke:ui` passed; UI smoke covered
  14 viewport/DPI cases without overflow or unlabeled controls.
- `npm run audit:subscription-runtime`, `audit:subscription-fixtures`,
  `audit:node-flow`, `audit:config-deployment`, `audit:config-extensions`,
  `audit:ipv6-dns`, `audit:backend`, `audit:responsiveness`, and
  `audit:control-plane` passed on 2026-07-26.
- The control-plane audit passed at main=11623/11770 and
  core_runtime=2896/2900 production lines. No budget or assertion was
  weakened; the backend audit now explicitly requires the dynamic primary
  group on both outbound-IP synchronization and current-route comparison.

## Current Limits

- This evidence proves isolated managed-core and Controller behavior, not a
  successful external proxy connection or Windows traffic takeover.
- Live system proxy, TUN, firewall, DNS, and external connectivity remain
  intentionally untested on this shared FlClash host.
- No unresolved P0 or P1 is known in the WM-03 safe matrix. WM-04 owns the
  next evidence target: navigation, diagnostics, stale results, and large-data
  behavior while background work is active.
