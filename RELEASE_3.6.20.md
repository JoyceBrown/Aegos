# Aegos 3.6.20

## Verified repair actions

- Added targeted repair actions for system proxy takeover, port conflicts, Aegos firewall cleanup, network-core restart, and network recovery.
- Repair actions run as background jobs and never disable global navigation.
- After a repair completes, Aegos reruns diagnostics and reports whether the affected check recovered.

## Safety

- Repair action names use a strict backend allowlist; arbitrary system actions are rejected.
- Existing transactional rollback and verification paths remain authoritative.
