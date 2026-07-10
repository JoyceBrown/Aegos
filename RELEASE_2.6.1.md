# Aegos 2.6.1

## Highlights

- Fixes rapid sidebar navigation feedback so page selection updates immediately while heavy page refresh work stays deferred until navigation settles.
- Strengthens the performance smoke test with 420 rapid sidebar switches across pointer and click paths.
- Adds structured log categories for user, runtime, core, diagnostic, and debug streams.
- Adds log-page filters that run entirely in the UI without backend calls.
- Makes Reality protocol handling explicit in the speed-test scheduler while keeping TUIC and Hysteria2 on slower adaptive phases.
- Adds abnormal subscription preflight coverage for missing proxy-group targets so bad subscriptions fail before core reload.

## Verification

- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run smoke:perf`
- `npm run audit:backend`
- `npm run audit:release`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `npm run build`

## Artifact

- Source-only small patch release. No installer is produced for 2.6.1.
- SHA-256: Source-only
