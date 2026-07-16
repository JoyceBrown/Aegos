# Aegos 3.6.15

Stage 5.7: read-only proxy and VPN conflict detection.

- Diagnostics inspect competing FlClash/Clash/VPN processes, external listeners on Aegos/reserved ports, active virtual adapters, and takeover routes.
- Findings explain the conflict and a manual next action in user-facing language.
- Aegos does not terminate other applications or disable their adapters.
- Source checkpoint; incorporated into the 3.6.16 acceptance installer.
