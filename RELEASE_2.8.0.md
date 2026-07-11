# Aegos 2.8.0

## Changes

- Promoted the 2.7.15-2.7.22 stability line to a daily-use stability checkpoint.
- Includes dedicated closure audits for runtime/versioning, speed tests, stable node ordering, landing IP, diagnostics/logs, responsiveness, system takeover/recovery, and repeated daily-use soak flows.
- Keeps speed tests measurement-only, preserves non-blocking navigation, avoids the 7890 port conflict, and keeps small-version installer churn closed until this checkpoint.

## Verification

- `node --check src/app.js`
- `node --check tools/interaction-smoke.js`
- `node --check tools/release-audit.js`
- `node --check tools/backend-audit.js`
- `node --check tools/speed-closure-audit.js`
- `node --check tools/outbound-ip-audit.js`
- `node --check tools/diagnostics-logs-audit.js`
- `node --check tools/responsiveness-audit.js`
- `node --check tools/system-takeover-audit.js`
- `node --check tools/soak-smoke.js`
- `npm run check`
- `npm run smoke:ui`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run smoke:soak`
- `npm run audit:backend`
- `npm run audit:speed`
- `npm run audit:outbound-ip`
- `npm run audit:diagnostics`
- `npm run audit:responsiveness`
- `npm run audit:takeover`
- `npm run audit:release`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run build`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.8.0_x64-setup.exe`
- Size: 15,346,082 bytes
- SHA-256: `00c77951960eaef7230ecdbeca10c0308abf5331c482e66511e041fbf22768ae`
