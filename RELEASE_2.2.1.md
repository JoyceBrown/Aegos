# Aegos 2.2.1

## Highlights

- Repair stale subscription metadata from existing profile YAML files at startup.
- Derive public profile counts from the real profile file when stored counts are missing or zero.
- Show subscription node and proxy-group counts together, with a repaired/stale metadata hint.
- Add audit coverage so valid subscriptions are not treated as empty because of stale settings metadata.

## Verification

- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run smoke:ui`
- `npm run audit:backend`
- `npm run audit:release`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.2.1_x64-setup.exe`
- SHA-256: 648f1bdae4033de63acdcb9de563129c3b6fbc19b0f11c802199ce3ba265ec44
