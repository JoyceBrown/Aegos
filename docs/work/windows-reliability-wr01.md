# WR-01 Windows Real-Use Reliability Evidence

record_kind: evidence_register
execution_authority: none
plan_id: AEGOS-WINDOWS-RELIABILITY
task_id: WR-01
evidence_state: closed
updated_at: 2026-07-27

## Boundary

All WR-01 execution used sanitized fixtures, mocked command boundaries, or an
isolated Aegos data root. It did not change the shared host system proxy, TUN,
DNS, firewall, kill-switch, external routing, or FlClash. Real Windows
takeover remains an explicitly untested environment limit, not a passed fact.

## Findings

| ID | Severity | State | Closure evidence |
| --- | --- | --- | --- |
| WR01-001 | P2 | repaired | Native WebView2 measurement cleanup terminates only its exact process tree/root and rejects residue. |
| WR01-002 | limit | untested | Real system proxy, TUN, DNS, firewall, and external-connectivity takeover requires a separate recoverable environment and remains outside WR-01. |
| WR01-003 | P1 | repaired | Job Object ownership, exact root identity, sentinel preservation, normal/panic/interruption coverage, and exact historical cleanup all passed. |
| WR01-004 | P1 | repaired | The 3.6.65 installer was built in a fresh versioned target and bound to current product/gate, acceptance, Mihomo, and artifact identities. |
| WR01-005 | P2 | repaired | The shared core-log reader stops on the first read error, remains joinable, redacts output, and passes focused regression and strict clippy. |
| WR01-006 | P3 | repaired | `.vs/` is ignored without deleting user IDE state and is absent from candidate inputs. |
| WR01-007 | P1 | repaired | The v2 runner executes every command and validates exact timestamped log bytes instead of accepting declared exit codes. |

## Final Host-Safe Matrix

- 224 Rust tests, 0 failed, 0 ignored.
- 12 product journeys with no missing command/job kind, forbidden side effect,
  or residual test root.
- Seven pages over 14 fixed window/DPI configurations.
- 800 streamed nodes and 420 navigation switches.
- 16 soak cycles.
- Hidden native WebView2 with automatic speed enabled and suppressed.
- Backend, responsiveness, stability, security, IPv6/DNS, outbound-IP,
  runtime, control-plane, architecture, planning, and local-backup gates.
- Every one of 25 distinct commands has current input identity and a hashed
  local log; source/gate inputs stayed unchanged across every command.

## Candidate

- Version: `3.6.65`.
- Artifact: `Aegos_3.6.65_x64-setup.exe`.
- Size: `16,325,000` bytes.
- SHA-256:
  `93d5691de31c5fe436b596c2075a5e0f62697464d998f5ec8a51b23fef462323`.
- Trust: unsigned local candidate; no GitHub Release or update publication.

## Completion

WR-01 is closed with the tested/untested boundary above. WR-02 was not
activated because no remaining reproduced user-visible P0/P1 qualifies it.
