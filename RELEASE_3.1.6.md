# Aegos 3.1.6

Source checkpoint for redacted recent rule hit summaries on the read-only
routing page.

## Changes
- Added `audit:routing-redaction` to guard rule-hit sanitization and safe DOM
  rendering.
- Sanitized recent rule names and connection chains in `routing_snapshot` before
  they are grouped and returned to the UI.
- Kept recent rule rendering on `textContent`/safe node helpers.
- Bumped package, Tauri, Cargo, and sidebar versions to 3.1.6.

## Verification
- `npm install --package-lock-only --ignore-scripts`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run audit:routing-redaction`
- `npm run audit:routing-selection`
- `npm run audit:security`
- `npm run audit:release`
- `npm run smoke:interactions`
- `npm run check`
- `git diff --check`

## Artifact
- Source checkpoint: no installer built for this checkpoint.
- SHA-256: Source-only
