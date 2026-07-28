# WR-14 Local Installer Delivery Evidence

record_kind: evidence_register
execution_authority: none
task_id: WR-14
change_id: CHANGE-045
evidence_state: closed
product_version: 3.6.70
validation_run_id: wr01-20260728080142-17376
validation_started_at: 2026-07-28T08:01:42.944Z
validation_finished_at: 2026-07-28T08:05:14.248Z
validation_source_digest: fc3b7a631701b4535dc43c1cda52cb3358c88a353f8f68c6dbb28510307a2994
validation_gate_digest: d78defe13d87f4006d7bfe85d162974c55ebaa233c60e3388eef12d608f59392

## Delivery Facts

- Default build command: `npm run build`.
- Artifact: `src-tauri/target/release/bundle/nsis/Aegos_3.6.70_x64-setup.exe`.
- Identity: 16,345,110 bytes; SHA-256
  `d68c431ebac8c1ba2649810845b7110e536706d784b951a6e16ea9820c0319b0`.
- Trust status: `Get-AuthenticodeSignature` returned `NotSigned`; no signing
  claim is made.
- The candidate was neither installed nor published. No Git operation, FlClash
  change, Windows proxy, TUN, DNS, firewall, kill-switch, or host-network action
  occurred.

## Acceptance

`npm run audit:wr01-acceptance` accepted the run above with all 25 required
commands at exit 0: formatting, 232 Rust tests, syntax, dependency audit,
interaction smoke, 14 fixed window/DPI UI configurations, 800-node/420-
navigation pressure, 16-cycle soak, enabled and suppressed native modes,
backend, responsiveness, stability, security, DNS/IPv6, outbound-IP, core,
runtime-regression, control-plane, architecture, planning, and local-backup
audits. The final provenance, installer, installer-regression, and trust gates
are rerun after this closure record so their current-input identities include it.

## Test Correction

The full Rust matrix initially rejected the isolated WM-01 recovery assertion
because this host already had an active Aegos-named TUN adapter and default
route. The old assertion required clearing the temporary marker even when
read-only evidence showed live takeover, contradicting recovery safety. The
corrected test proves that a marker is retained while live Aegos TUN evidence
exists and cleared when it does not. The focused WM-01 test and the full 232-test
matrix both passed; no runtime network behavior was changed.
