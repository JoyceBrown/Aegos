# Aegos 2.9.53

Source-only release. No installer was built for this checkpoint.

## Changes
- Added `core-api-contract.md` as the Mihomo controller API contract for Aegos.
- Documented the allowed controller envelope, read-only APIs, measurement-only APIs, mutating APIs, timeout expectations, rollback expectations, and future adoption gates.
- Explicitly locked the speed-test contract: delay testing may update delay, health, recommendation, confidence, and failure reason, but must not switch nodes or take over traffic.
- Added open-source absorption audit checks so future reference-project work cannot continue without the core API contract.
- Bumped package, Tauri, Cargo, and sidebar versions to 2.9.53.

## Verification
- `npm run audit:opensource`
- `npm run audit:speed`
- `npm run audit:release`
- `git diff --check`

## Artifact
- Source-only: no installer for 2.9.53.
- SHA-256: Source-only
