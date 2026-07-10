# Aegos 0.5.10

## Fixes
- Fixed one-click speed test delay display by reducing controller delay-test concurrency.
- Added per-node retry across multiple connectivity test URLs, improving TUIC subscription delay results.
- Added runtime speed-test summary logs with successful, failed, and total node counts.
- Kept the 0.5.9 runtime self-healing behavior that restarts mihomo when the active profile or controller port drifts.

## Verification
- Pending final local checks, installer build, install, and real runtime verification.
