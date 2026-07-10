# Aegos 2.6.0

## Highlights

- Promotes Aegos from route optimization toward system proxy takeover readiness.
- Captures the previous Windows system proxy before Aegos takes over, then restores that snapshot when Aegos stops or exits.
- Adds real Windows proxy diagnostics so Aegos can tell whether Windows is actually pointing at the Aegos endpoint.
- Adds mixed/controller port availability diagnostics with owner lookup to expose conflicts before takeover.
- Adds a `repairSystemProxy` background job and Settings-page repair action for reapplying Aegos system proxy takeover without freezing the UI.
- Tightens large node list windowing to reduce long-task risk during rapid filter/search interactions.
- Keeps FlClash/Codex port isolation intact: Aegos still avoids `7890` and defaults to `7891/19091`.

## Verification

- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run smoke:perf`
- `npm run audit:backend`
- `npm run audit:release`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `npm run build`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.6.0_x64-setup.exe`
- Size: `15,263,646 bytes`
- SHA-256: `8378aed1437b8e6998a0393ce7c6d671b91b91f931681a550a97aa8cc0c1f9c9`
