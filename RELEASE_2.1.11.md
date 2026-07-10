# Aegos 2.1.11

## Highlights

- Strengthen diagnostics with per-check severity, category, actionable hints, and a summary block.
- Improve the diagnostics page so errors and warnings are sorted first and paired with next-step suggestions.
- Add a copyable diagnostics report for sharing startup, profile, port, and recent log context.
- Color the global notice bar by severity instead of always showing success green.
- Expand backend, release, interaction, and UI smoke checks for diagnostics regressions.

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
