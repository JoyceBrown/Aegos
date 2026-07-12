# Aegos 2.9.58

Source-only release. No installer was built for this checkpoint.

## Changes
- Added `copy-encoding-debt.md` to freeze current copy and encoding debt.
- Added `audit:copy` to track suspicious production UI text, UTF-8 metadata,
  dynamic text rendering safety, and cleanup route coverage.
- Wired the copy/encoding gate into release audit.
- Bumped package, Tauri, Cargo, and sidebar versions to 2.9.58.

## Verification
- `npm run audit:copy`
- `npm run audit:release`
- `git diff --check`

## Artifact
- Source-only: no installer for 2.9.58.
- SHA-256: Source-only
