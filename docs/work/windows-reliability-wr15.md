# WR-15 Controlled Routing And Acceptance Integrity Closure

record_kind: evidence_register
execution_authority: none
plan_id: AEGOS-WINDOWS-RELIABILITY
task_id: WR-15
change_id: CHANGE-046
evidence_state: closed
delivery_scope: local-only unsigned candidate; not installed, published, committed, or pushed
host_boundary: host-safe:no-windows-takeover:no-flclash-mutation

## Closed Scope

- The routing surface now states the true product boundary: Aegos-owned user
  rules use structured preflight, apply, rollback, and background-job paths;
  subscription/Mihomo rules and Aegos protection rules are read-only.
- Static checks now recognize the existing outlet-IP sequence guard, IPv6/DNS
  probe coalescing, and test-module-only persistence fixtures without masking
  a production write or reducing a behavioral bad control.
- The WR-01 matrix includes five additional direct gates: routing product,
  controlled routing boundary, connection closure, global interaction, and
  debt. Existing commands, viewports, fixtures, timing floors, pressure, soak,
  and native modes are retained.

## Delivery Evidence

The current executable acceptance record is `.validation/wr01/acceptance.json`.
The current provenance manifest is `.validation/wr01/candidate-provenance.json`.
The local candidate is
`src-tauri/target/release/bundle/nsis/Aegos_3.6.70_x64-setup.exe`, 16,339,868
bytes, SHA-256
`0c71d5176f195a00fd7de79ce7bd8aa3e33ffc084db269eed2e496488b848e5c`, and
Authenticode status `NotSigned`.

No Windows takeover, host proxy/TUN/DNS/firewall/kill-switch action, FlClash
action, installation, publication, Git action, or Mihomo replacement occurred.
