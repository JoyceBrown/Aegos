# WR-06 Conventional Status Evidence Register

record_kind: evidence_register
execution_authority: none
plan_id: AEGOS-WINDOWS-RELIABILITY
task_id: WR-06
change_id: CHANGE-035
evidence_state: accepted_pending_publication
opened_at: 2026-07-27T13:45:19Z
updated_at: 2026-07-27T14:11:16Z
base_git_head: 9353622b42f64937b68f68f2a36277fd70ff9d28
host_boundary: Host-safe fixture, browser, and native probe validation only. No
  Windows takeover, proxy, DNS, firewall, TUN, FlClash, or host-network action.

This register records the user-authorized WR-06 repair. It cannot authorize
further product work or publication by itself.

## Finding Register

| ID | Severity | Finding | Deterministic known-bad control | Repair | State |
| --- | --- | --- | --- | --- | --- |
| WR06-001 | P1 | Sidebar labels were nonstandard or could be clipped. | Fixed-window/DPI UI smoke rejects missing full `延迟`, `稳定性`, `落地 IP`, or a clipped metric label/value. | Use conventional labels and an intrinsic metric-grid value column. | repaired |
| WR06-002 | P1 | Primary Home exposed internal standby/takeover wording when disconnected. | Interaction fixture with a ready core and no verified takeover rejects `核心待命` and unclaimed-system-traffic copy. | Present `未连接` plus a direct connection/retry route; retain detailed facts in diagnostics. | repaired |
| WR06-003 | P2 | Disconnect protection had an abbreviated action and visible redundant state suffix. | Interaction fixture rejects an abbreviated label, `未开启`, missing switch semantics, or an absent full accessible name. | Keep one complete visible `断网保护` switch label with `aria-checked`. | repaired |
| WR06-004 | P1 | One-run relative ranking could call a consistently high-latency node unstable and did not model historical variation. | A stable 300 ms node with three 10/30-minute samples must be high; a volatile history must be low; insufficient or stale history cannot be high. | Store bounded per-node observations and rate the largest rolling 10/30-minute mean-absolute-deviation ratio. | repaired |

## Rejected Attempts Retained

- The first `audit:release` attempt exited 2 because its static check expected
  a pre-refactor source shape for the connect/outbound-IP sequence. The
  corrected gate now requires both verified takeover before refresh and the
  disconnected retry remediation. The repaired release audit exited 0 at
  2026-07-27T13:55:00Z.
- The first complete WR-01 attempt reached 21 executed commands and was
  rejected by `audit:runtime-regression` because the 3.6.69 release note did
  not list its four required recovery commands. The release note was completed;
  the repaired runtime and release gates exited 0 at 2026-07-27T14:06:33Z.
- A manually interrupted preliminary WR-01 run and one failed Windows process
  wrapper invocation are retained under `.validation` and are not counted as
  passing evidence. The final run below replaced neither failure with a retry
  claim nor reduced the matrix.

## Accepted Evidence

- Version identity: `package.json`, `src-tauri/Cargo.toml`,
  `src-tauri/tauri.conf.json`, and the visible shell identify `3.6.69`.
- Candidate build: `npm run build` from 2026-07-27T13:45:19Z through
  2026-07-27T13:49:48Z produced
  `src-tauri/target/release/bundle/nsis/Aegos_3.6.69_x64-setup.exe`.
  It is 16,345,798 bytes with SHA-256
  `a85a8335ce67c6fa30fe8cca9eeeb89aa9198dd9fa76086b5a84d8cf3789a4cd`.
  It is unsigned and no automatic-update channel is enabled.
- Final WR-01 acceptance run `wr01-20260727140656-14692` ran from
  2026-07-27T14:06:56.976Z through 2026-07-27T14:10:04.281Z with a dirty
  worktree rooted at the recorded baseline. Its source digest is
  `7821f73f64829a5848007904e10b6242e952a2c8e10069ff0a697373e0785df0` and
  gate digest is
  `7c21f95fa25490bb5bfdcbc698ca1435bbe092b3625585df287394667dd182ae`.
- All 25 required commands executed and exited 0: diff/fmt/Rust (229 passed),
  JavaScript syntax, npm audit, interaction smoke (12 journeys), fixed
  window/DPI UI smoke (14 configurations), 800-node/420-navigation pressure,
  16-cycle soak, native performance with automatic speed enabled and
  suppressed, backend, responsiveness, stability, security, IPv6/DNS,
  outbound-IP, core-runtime, runtime-regression, control-plane, architecture,
  planning-context, and local-backup audits.
- The final interaction, UI, stress, and soak reports found zero residual
  test roots. Candidate provenance, installer, release, and unsigned-trust
  audits exited 0 after the final acceptance record was written.
- The shared-host boundary held throughout. No FlClash process, Windows system
  proxy, TUN, DNS, firewall, kill switch, or live network takeover was changed.

No P0 or P1 remains open for CHANGE-035. Publication remains a separate
delivery action authorized by the active plan and user request.
