# Aegos

Aegos is a Windows desktop proxy client built with Tauri, Rust, and WebView2.
It owns product state, configuration transactions, Windows network takeover,
diagnostics, and recovery. Mihomo remains the managed data plane.

## Current Direction

- Verified: repository and package version markers are 3.6.65.
- Verified: CHANGE-027 closed WR-01 with an executable, source-bound host-safe
  matrix. The current unsigned x64 NSIS candidate is
  `Aegos_3.6.65_x64-setup.exe` (16,325,000 bytes, SHA-256
  `93d5691de31c5fe436b596c2075a5e0f62697464d998f5ec8a51b23fef462323`).
- Decided: the only development mainline is Windows real-use reliability. The
  target is a trustworthy import, connect, observe, switch, disconnect, and
  recover workflow under slow, failed, and interrupted operations, not feature
  breadth.
- Decided: Aegos is the product control plane and Mihomo is the managed data
  plane. Aegos will not reimplement protocols, DNS, TUN, forwarding, or a
  rules engine.
- Not planned: signing, public-release automation, automatic updates, WebDAV
  or cloud sync, a second core, Windows ARM64, and non-Windows platforms. They
  require a future explicit route decision.

Long-term sequencing is in docs/roadmap.md. `PLANS.md` is the only repository
plan that may authorize work when active; it is currently completed. The
current work checkpoint is docs/work/current.md.

## Product Capability Baseline

- Subscription import and update, ordinary and fixed node management, upstream
  proxy support, and user-facing routing.
- Transactional connect, disconnect, system proxy, TUN, kill-switch,
  configuration deployment, and startup recovery.
- Measurement-only node testing, outlet identity, DNS and IPv6 effective-state
  reporting, diagnostics, and redacted evidence export.
- Controlled configuration extensions with preflight, intent preview, runtime
  validation, rollback, and protected fields.
- Local Windows-user DPAPI backup and disconnected restore for selected user
  data; no network transfer or synchronization.

The capability baseline is not a claim that every real Windows environment has
been proven. The Windows Real-Use Reliability mainline starts from that gap:
it collects evidence, reproduces genuine defects, and fixes them without
changing the shared host network.

## Repository Map

- src/: desktop UI and user workflows.
- src-tauri/src/: Rust control plane, runtime domains, deployment,
  diagnostics, and Windows takeover.
- resources/core/: approved managed Mihomo runtime resources.
- tools/: product, security, performance, architecture, and package audits.
- docs/: authoritative product, architecture, route, and historical records.
- docs/decisions/windows-reliability-mainline.md: analysis, competitor
  comparison, and durable mainline decision.

See docs/architecture.md for module and data-flow boundaries, and docs/INDEX.md
for the document authority map.

## Development

Requirements:

- Windows 10/11 x64
- Node.js and npm
- Rust stable with the MSVC target
- Visual Studio C++ Build Tools
- WebView2 Runtime

~~~powershell
npm install
npm run check
npm run dev
~~~

Build an NSIS installer locally:

~~~powershell
npm run build
~~~

The output is under src-tauri/target/release/bundle/nsis/. A local build does
not authorize a Git commit, GitHub push, Release publication, signing action,
or automatic update channel unless the user grants that action explicitly.

## Verification

Run checks proportional to the changed behavior. The Windows Real-Use
Reliability plan defines its current acceptance matrix; its baseline includes:

~~~powershell
cargo test --manifest-path src-tauri/Cargo.toml
npm run smoke:interactions
npm run smoke:ui
npm run audit:backend
npm run audit:responsiveness
npm run audit:security
npm run audit:control-plane
npm run audit:planning-context
~~~

Current evidence and known gaps are recorded in docs/work/current.md.

## Security

Do not commit real subscription URLs, tokens, node credentials, private keys,
diagnostic exports, or local settings. Logs, fixtures, screenshots, release
notes, and exported reports must redact sensitive data. Preserve third-party
licenses; do not copy GPL code, icons, or UI assets.
