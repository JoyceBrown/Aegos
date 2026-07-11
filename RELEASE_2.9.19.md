# Aegos 2.9.19

## Scope

This release closes the 2.9.13-2.9.19 current-function hotfix and security hardening lane.

## 2.9.13 Connection Closure

- Verified Windows system proxy takeover after applying it.
- Fixed takeover state so Aegos only reports traffic takeover when system proxy is actually applied or TUN is enabled.
- Surfaced Windows proxy restore failure on disconnect instead of silently ignoring it.

## 2.9.14 Speed Closure

- Re-audited batch and single-node speed tests as measurement-only operations.
- Kept speed tests on standby core preparation without proxy switching.
- Kept UI navigation/filtering responsive while speed tests are running.

## 2.9.15 Subscription Update/Switch Security

- Added shared sensitive text redaction for subscription tokens, passwords, UUIDs, bearer tokens, and URI userinfo.
- Redacted public subscription metadata returned to the UI.
- Preserved existing subscription preflight and rollback checks.

## 2.9.16 Status Consistency

- Kept LAN IP wording/value checks from 2.9.12.
- Added security audit coverage that status/log paths do not expose raw network secrets.
- Preserved smart-mode outbound IP routing checks.

## 2.9.17 Disconnect Protection

- Re-audited scoped speed-test firewall allow rules under disconnect protection.
- Kept temporary speed-test firewall rules tied to marker cleanup.
- Preserved firewall verification and rollback checks.

## 2.9.18 First-Install Environment

- Changed the Windows installer WebView2 policy from skip to download bootstrapper with visible installer UI.
- Kept controller binding to 127.0.0.1 and allow-lan disabled by default.
- Added security audit checks for controller binding, generated secret, and minimal Tauri ACL.

## 2.9.19 UI Stability and Security Gate

- Added `npm run audit:security`.
- Audited dynamic UI render paths for escaped user/core text.
- Kept rapid navigation, diagnostics, speed-test, and release audits in the verification gate.

## Verification

- `node --check src/app.js`
- `node --check tools/security-hotfix-audit.js`
- `node --check tools/release-audit.js`
- `npm run audit:security`
- `npm run audit:takeover`
- `npm run audit:speed`
- `npm run audit:backend`
- `npm run audit:subscription`
- `npm run audit:subscription-fixtures`
- `npm run audit:outbound-ip`
- `npm run audit:diagnostics`
- `npm run audit:responsiveness`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run smoke:ui`
- `npm run smoke:soak`
- `npm run check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run build`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.9.19_x64-setup.exe`
- Size: 15,389,048 bytes
- SHA-256: `502e16178e126805361808bc23b14107112162b7e6fe1cf8e12bd465dc4ba712`
