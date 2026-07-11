# Aegos 2.7.21

## Changes

- Added a dedicated system takeover and recovery audit.
- Guarded Windows proxy snapshot/restore, manual system-proxy preference semantics, disconnect-protection firewall verification, scoped speed-test firewall windows, port-conflict diagnostics, transactional settings rollback, and repair/recovery jobs.
- Kept this checkpoint source-only; installer build remains reserved for 2.8.0.

## Verification

- `node --check tools/system-takeover-audit.js`
- `npm run audit:takeover`
- `npm run audit:speed`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run check`

## Artifact

- Source-only release; no installer for this takeover/recovery audit checkpoint.
- SHA-256: Source-only
