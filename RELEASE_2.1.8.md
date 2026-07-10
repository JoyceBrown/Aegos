# Aegos 2.1.8

## Highlights

- Added save-time port validation for settings updates.
- Rejects mixed proxy port `7890` before saving to avoid FlClash/Codex conflicts.
- Rejects mixed proxy and controller ports when they are set to the same value.
- Settings updates now roll back if validation, direct profile refresh, or restart fails.
- Runtime port preparation avoids assigning the controller to the selected mixed proxy port.

## Verification

- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run smoke:ui`
- `npm run audit:backend`
- `npm run audit:release`

## Artifact

- Source-only: no installer was built for this small version.
- SHA-256: Source-only; no installer artifact.
