# Aegos 2.7.16

## Changes

- Added a dedicated speed-closure audit for measurement-only speed testing.
- Guarded batch, one-click, and single-node speed tests against accidental proxy switching or best-node selection.
- Added focused checks for non-blocking speed UI, disconnect-protection speed-test allow rules, `<100 ms` low-latency membership, and protocol-aware TUIC/Reality/Hysteria2 scheduling.

## Verification

- `node --check tools/speed-closure-audit.js`
- `npm run audit:speed`
- `npm run audit:backend`
- `npm run audit:release`

## Artifact

- Source-only release; no installer for this speed-closure audit checkpoint.
- SHA-256: Source-only
