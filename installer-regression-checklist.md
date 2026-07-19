# Aegos Installer Regression Checklist

Applies to: 3.6.36 and later installer checkpoints
Updated: 2026-07-19

Purpose: define the real Windows installer regression checklist that must be completed before any installer checkpoint is given to the user. This document is a test plan, not evidence that an installer has passed; each release must retain its own environment, artifact hash, execution results, and remaining risks.

## 0. Test Environment And Recovery Preconditions

- Run install, forced-termination, TUN, firewall, and uninstall scenarios in an isolated VM or dedicated test account. A shared daily-use Windows profile requires an explicit owner-approved recovery plan before those scenarios begin.
- Before every destructive scenario, record a sanitized baseline of Aegos version, proxy enabled/PAC/auto-detect state, relevant routes/adapters, firewall rule counts, and whether the process is elevated. Do not record subscription URLs, tokens, node credentials, controller secrets, or public IPs.
- After every destructive scenario, verify the saved baseline has been restored before starting the next scenario. A failed recovery ends the run and blocks the installer checkpoint.
- The released 3.6.35 installer is only a behavior baseline. Never package changed source as another `Aegos_3.6.35_x64-setup.exe`, and never use a locally rebuilt artifact to replace or validate the published release asset.

## 1. Installer Preconditions

- Package, Tauri, Cargo, sidebar version labels match.
- NSIS installer name uses `Aegos_{version}_x64-setup.exe`.
- Old `Aegis` installer naming is not reused.
- Bundled core is `resources/core/mihomo.exe`.
- No experimental `sing-box.exe` is bundled in the main installer.
- WebView2 bootstrapper is configured and not silent, so missing runtime can be handled for normal users.
- Default mixed port remains `7891` to avoid FlClash/Codex traffic on `7890`.
- Controller remains `127.0.0.1` only with generated secret.
- `allow-lan` remains off by default.

## 2. First Install Regression

Manual checklist:

```text
Machine:
Windows build:
User type:
Aegos version:
Installer path:
SHA-256:

[ ] Installs without developer tools.
[ ] WebView2 missing runtime path is understandable.
[ ] App starts from Start Menu/desktop shortcut.
[ ] No Aegis name appears in installer UI or install directory.
[ ] App data directory is created under Aegos identity.
[ ] Default ports avoid 7890.
[ ] Logs open without mojibake.
```

## 3. Network Takeover Regression

Manual checklist:

```text
[ ] Connect with TUN off applies Windows system proxy.
[ ] Disconnect restores previous system proxy.
[ ] App exit restores previous system proxy.
[ ] Failed core start does not leave system proxy pointing to Aegos.
[ ] Manual system proxy toggle does not auto-connect core.
[ ] TUN on/off state is reflected in UI.
[ ] Disconnect protection enable failure rolls back.
[ ] Disconnect protection close cleans firewall rules.
[ ] Repair/recovery action can restore proxy/firewall state.
[ ] Existing PAC URL and auto-detect state are restored byte-for-byte after disconnect.
[ ] With TUN enabled, Windows shows the dedicated Aegos adapter and Aegos-owned takeover routes.
[ ] Force-terminate Aegos with system proxy active; relaunch restores the saved proxy/PAC state.
[ ] Force-terminate Aegos with disconnect protection active; relaunch as administrator restores firewall profile defaults and removes both Aegos rule groups.
[ ] Force-terminate Aegos with TUN active; relaunch stops only the bundled Aegos engine and confirms no Aegos adapter route remains.
[ ] A competing FlClash/Clash/VPN process, occupied port, or virtual adapter is reported without being terminated or disabled.
```

## 4. Subscription And Speed Regression

Manual checklist:

```text
[ ] Import normal Clash YAML subscription.
[ ] Import URI/base64 subscription.
[ ] Import VLESS/TUIC/AnyTLS/Hysteria2 mixed subscription.
[ ] Switch subscription while disconnected.
[ ] Switch subscription while connected.
[ ] Switch subscription during speed test; stale speed result does not leak into new subscription.
[ ] One-click speed test does not switch node.
[ ] Batch speed test does not switch node.
[ ] Single-node speed test does not switch node.
[ ] Failed speed result shows reason.
```

## 5. UI Responsiveness Regression

Manual checklist:

```text
[ ] Rapid navigation does not freeze.
[ ] Diagnostics can run while switching pages.
[ ] Speed test can run while switching pages.
[ ] Logs page opens without blocking navigation.
[ ] Large subscription first screen does not freeze.
[ ] Quick subscription menu appears above other layers.
[ ] Different window heights do not cause layout jumps.
```

## 6. Automated Gates Before Installer Release

Required:

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `node --check src/app.js`
- `npm run audit:backend`
- `npm run audit:stability`
- `npm run audit:speed`
- `npm run audit:speed-target`
- `npm run audit:security`
- `npm run audit:responsiveness`
- `npm run audit:architecture`
- `npm run audit:diagnostics`
- `npm run audit:subscription`
- `npm run audit:subscription-fixtures`
- `npm run audit:outbound-ip`
- `npm run audit:takeover`
- `npm run audit:system-takeover-stage5`
- `npm run audit:opensource`
- `npm run audit:flclash`
- `npm run audit:provider-healthcheck`
- `npm run audit:debt`
- `npm run smoke:ui`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run smoke:soak`
- `npm run build`
- `npm run audit:installer`
- `npm run audit:release`
- `git diff --check`

## 7. Stop Conditions

Do not provide an installer if:

- Version labels do not match.
- Installer artifact hash is missing from release notes.
- Speed test can switch node.
- System proxy can remain after failure or exit.
- Disconnect protection firewall rules cannot be cleaned.
- Logs or diagnostics expose subscription token, node password, or controller secret.
- UI navigation freezes during diagnostics or speed tests.
- WebView2 missing runtime path is not handled.
