# Aegos 0.5.3

## Fixes

- Added TUIC URI subscription parsing for base64 subscription feeds.
- Fixed realtime traffic polling by reading one `/traffic` stream snapshot instead of waiting for the streaming endpoint to finish.
- Replaced the frequent PowerShell LAN IP probe with a lightweight UDP socket lookup to reduce UI stalls.

## Verification

- `npm run check`
- `node --check src\app.js`
- `node --check tools\release-audit.js`
