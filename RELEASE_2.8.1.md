# Aegos 2.8.1

## Changes

- Fixed diagnostics-time UI stalls by moving expensive diagnostics work outside the `CoreManager` mutex.
- Diagnostics now takes a short backend snapshot first, then performs config preflight, Windows proxy inspection, and port owner checks without blocking `app_status` or `proxy_groups`.
- Extended diagnostics audit coverage to prevent this lock regression from returning.

## Verification

- `npm run audit:diagnostics`
- `npm run smoke:interactions`
- `npm run check`

## Artifact

- Source-only release; no installer requested for this diagnostics responsiveness fix.
- SHA-256: Source-only
