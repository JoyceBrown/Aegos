# WR-03 Current-Code Reliability Evidence Register

record_kind: evidence_register
execution_authority: none
plan_id: AEGOS-WINDOWS-RELIABILITY
task_id: WR-03
change_id: CHANGE-032
evidence_state: closed
updated_at: 2026-07-27T11:08:22Z
closed_at: 2026-07-27T11:08:22Z
base_git_head: 7720fac057ec290b7ddbbb5e5fd3849f71449f1a
pre_final_register_diff_sha256: 7bffb6a49f8a5e5c00fdd610a51cff38d16565f2ddb7c1b920ae1be3d40dbf02
host_boundary: Isolated data roots and local fixtures only. No Windows takeover,
  no FlClash process, configuration, listener, adapter, DNS, proxy, firewall,
  or TUN change is permitted.

This register records the current repair batch. It does not authorize work.
Every finding remains open until its repaired behavior and its known-bad
control are recorded here with fresh command evidence.

## Finding Register

| ID | Severity | Finding | Known-bad control | Repair target | State |
| --- | --- | --- | --- | --- | --- |
| WR03-001 | P1 | The shell showed connected from takeover intent while availability was checking or unavailable. | Interaction fixture sets takeover true and `networkUsable: false`; it rejects `connected`, then accepts verified usable connectivity. | Require takeover and verified usable network. | repaired |
| WR03-002 | P1 | Exhausted automatic recovery left the last failed proxy selected. | The fixture first switches `Fixture SS -> Fixture VLESS`, then requires recovery restoration of runtime-visible and persisted `Fixture SS`. | Snapshot selections before the first candidate and restore them on exhaustion. | repaired |
| WR03-003 | P1 | A long recovery held the core mutex and could stall status, diagnostics, or Connections. | A busy first Connections read must return explicit preparation; a later busy read returns the cached snapshot. | Nonblocking cached read paths for status, diagnostics, and Connections. | repaired |
| WR03-004 | P1 | Corrupt active-takeover evidence was treated as inactive and could be overwritten. | Malformed `system-takeover-active.json` rejects mutation instead of defaulting. | Preserve evidence and require manual repair. | repaired |
| WR03-005 | P2 | A rejected profile preflight erased the current profile speed state before rejecting the target. | A malformed target profile leaves active profile and the `Fixture VLESS` health entry intact. | Preflight before any speed-state reset or cancellation. | repaired |
| WR03-006 | P2 | Dead frontend escaping code and public lock unwraps obscured real safety behavior and could panic on poisoned state. | Architecture/security audits reject dangerous DOM sinks and require the named-lock manual-node command path. | Remove the dead helper and use named lock errors in touched commands. | repaired |

## Initial Evidence

- Source review at `7720fac057ec290b7ddbbb5e5fd3849f71449f1a` identified the
  six findings above. This is diagnosis evidence, not closure evidence.
- A focused Rust run initially exposed a compile mismatch in the status-cache
  payload and a missing temporary fixture directory in the takeover negative
  test. Both were corrected before the latest test run; the failed attempts are
  retained here so a later rerun does not erase them.
- The first planning-context audit after activating WR-03 failed because the
  gate still searched for a historical CHANGE-031 Release sentence in the
  checkpoint. The gate was narrowed to the authoritative structured
  `CHANGE-032` and `WR-03` fields; its next run must pass before closure.
- One attempted focused Cargo command supplied two test filters, which Cargo
  rejects before executing tests. It is not test evidence and is retained here;
  each focused test is run separately below.
- A formatting check caught two newly added test-layout differences before the
  next full suite. `cargo fmt` is applied before rerunning that check; the
  check is not counted as passed until then.
- The first full affected matrix found two gate defects: the security audit
  required a removed `lock().unwrap()` call as proof of credential isolation,
  and the control-plane gate rejected the new `main.rs` production-line count.
  The security assertion now checks the equivalent named-lock command path;
  recovery-selection and snapshot-cache helpers are moved to focused modules
  before both gates are rerun. Neither failure is treated as a warning.
- The first rerun attempted to pass two Cargo test filters in one invocation,
  which Cargo rejects before test execution. The remaining focused checks are
  run as separate commands or by the full suite. The same rerun exposed the
  backend audit's stale `clear_logs` unwrap string and the remaining eight-line
  `main.rs` budget excess; its rule now verifies the new nonblocking connection
  path and diagnostics snapshot extraction is moved out of `main.rs`.
- A parallel native-performance run was interrupted while compiling and emitted
  no terminal result. It remains untested until each automatic-speed mode is
  rerun in its own command; no earlier UI or stress output is used to infer it.

## Closure Evidence

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` and
  `cargo test --manifest-path src-tauri/Cargo.toml` completed with exit 0;
  the latter ran 228 tests with 0 failed and 0 ignored. Focused controls also
  passed for corrupt takeover evidence, rejected profile preflight, exhausted
  recovery restoration, and cached busy Connections reads.
- `npm run smoke:interactions`, `npm run smoke:ui`,
  `npm run smoke:perf:stress`, and `npm run smoke:soak` completed with exit 0.
  The 800-node pressure case recorded 420 navigations (p95 0.3 ms), repeated
  speed feedback in 4.1 ms, and a connection-page exit first frame in 8.0 ms.
- Native WebView2 runs completed with exit 0 in both automatic-speed modes.
  Cold Connections first frames were 34.2 ms (enabled) and 33.6 ms
  (suppressed). The suppressed run retained warnings for a 75.0 ms paint sample
  and 52.3 ms diagnostics sample; the gate did not fail, and no limit was
  changed to accept them.
- Exit-0 affected gates: backend, responsiveness, stability, security,
  IPv6/DNS, outbound IP, local backup, core runtime, runtime regression,
  control plane, architecture, and planning context. `npm audit --json`
  reported zero vulnerabilities. `git diff --check` and JavaScript syntax
  checks for all changed scripts completed with exit 0.
- Host boundary: no Windows takeover, proxy, DNS, firewall, TUN, or FlClash
  mutation was performed. The observed FlClash process stayed at its installed
  path. The observed Aegos and Mihomo processes were Explorer-launched user
  processes, not test-owned children, and were left running.

No P1 remains open for CHANGE-032. The local 3.6.67 installer and GitHub
Release remain historical evidence and were not rebuilt, relabelled, uploaded,
or changed by WR-03.
- No installer, GitHub publication, signing, automatic update, live takeover,
  or host-network validation is part of WR-03.
