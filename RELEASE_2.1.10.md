# Aegos 2.1.10

## Highlights

- Extend the global optimistic UI pass to subscription import, current subscription update, single subscription update, and update-all flows.
- Keep busy buttons clickable-looking and non-blocking with `aria-busy`, `data-busy`, and `is-pending` feedback instead of disabling controls.
- Add unified pending row feedback for subscription operations so the list responds immediately while background jobs continue.
- Expand interaction and release audits to prevent regressions to wait-for-backend UI behavior.

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
