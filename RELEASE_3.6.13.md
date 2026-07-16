# Aegos 3.6.13

Stage 5.5: TUN validation.

- Candidate validation requires TUN enable state, automatic route, interface detection, and safe runtime DNS.
- Connected validation requires controller readiness, Windows adapter/route evidence, and a no-proxy connectivity probe.
- A failed validation restores the previous settings and runtime instead of leaving a half-applied TUN state.
- Source checkpoint; incorporated into the 3.6.16 acceptance installer.
