# WM-01 Windows Truth Baseline

record_kind: evidence_register
execution_authority: none
plan_id: AEGOS-WINDOWS-MATURITY
task_id: WM-01
status: completed
updated_at: 2026-07-26

This register is evidence for WM-01. It does not authorize another task; the
active plan remains `../../PLANS.md`.

## Test Boundary

The real runtime case uses the repository's approved `resources/core/mihomo.exe`,
the sanitized `clash-basic.yaml` fixture, and a uniquely named temporary Aegos
data root. It forces system proxy, startup proxy, TUN, and kill-switch off. It
does not start, stop, configure, or take over FlClash.

The browser interaction smoke still installs mocked Tauri commands. It remains
a UI regression layer, not proof of managed Mihomo, Windows takeover, or
connectivity.

## Journey Matrix

| Journey | Saved intent | Runtime fact | Windows takeover fact | Connectivity fact | Evidence |
| --- | --- | --- | --- | --- | --- |
| Import sanitized profile | Profile transaction persists `WM-01 Fixture`. | Generated runtime candidate preflights. | No system setting is requested. | Not measured. | Real detached import in `wm01_isolated_managed_core_journey_uses_real_mihomo_without_windows_takeover`. |
| Start in standby | Settings explicitly disable proxy, TUN, and kill-switch. | Managed Mihomo starts and its authenticated controller answers `/version`. | `trafficTakeover=false`; no durable takeover marker. | Deliberately unverified: standby must not claim connection. | Same real journey. |
| Select node | Aegos stores `Fixture -> Fixture VLESS`. | Controller accepts the selection and its proxy catalog reports `Fixture VLESS`. | No Windows mutation. | Not measured. | Same real journey. |
| Stop | User intent remains local only. | Child process is removed and runtime state is cleared. | No takeover remains. | Not measured. | Same real journey and RAII cleanup. |
| Missing core failure | Existing profile remains intact. | Start returns `mihomo core not found`; no child process exists. | No Windows mutation. | Not measured. | Same real journey. |
| Interrupted startup recovery | Only a temporary app-data `tun` marker is created. | Fresh manager performs its recovery scan using a non-existent test core path. | Marker is cleared after read-only TUN evidence; no adapter, route, proxy, DNS, or firewall is changed. | Not measured. | Same real journey. |
| System proxy or live TUN connection | Not exercised in this shared host. | Open for later controlled evidence. | Intentionally not changed because FlClash is the host network dependency. | Intentionally not measured. | Environment safety boundary, not a pass claim. |

## Defect Register

| ID | Priority | Reproduction | Expected terminal state | Observed state | Resolution and regression target |
| --- | --- | --- | --- | --- | --- |
| WM01-001 | P1, resolved | Import `clash-basic.yaml`, then start a real standby Mihomo runtime. | Runtime preflight preserves every rule target or rejects the profile before launch. | The compiler replaced the sole `Fixture` group with default groups but retained `MATCH,Fixture`; Mihomo exited before ready. | Preserve a single custom group while adding defaults; reject any unresolved rule target in runtime preflight. Covered by profile-compiler, routing-domain, and real managed-core journey tests. |

## Closure Evidence

- `cargo test --manifest-path src-tauri/Cargo.toml` passed: 218 tests.
- The isolated managed-Mihomo journey passed after the compiler fix; its RAII
  cleanup removes only its test child and temporary data root. The same journey
  now covers standby restart and retry after a missing-core terminal failure.
- `npm run smoke:interactions`, `npm run smoke:ui`, `npm run audit:backend`,
  `npm run audit:responsiveness`, `npm run audit:stability`,
  `npm run audit:security`, `npm run audit:planning-context`, and
  `npm run audit:control-plane` passed on 2026-07-26.
- The control-plane budget remained unchanged at main=11581/11770 and
  core_runtime=2893/2900 production lines.

## Current Limits

- The passed standby journey proves managed-core lifecycle and controller facts,
  not a successful external proxy connection.
- A real system-proxy or TUN takeover requires an isolated, recoverable host
  test environment before it can be called verified. It must not be exercised
  against this host's FlClash dependency.
- No unresolved P0 or P1 is currently known in the covered safe matrix. The
  completed P1 remains recorded so later regressions have a concrete target.
