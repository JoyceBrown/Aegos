# Aegos

Aegos is a Windows proxy client built with Tauri, Rust, WebView2, and a managed Mihomo data plane. The product layer owns connection truth, background task scheduling, configuration transactions, Windows network takeover, diagnostics, rule editing, and recovery.

Current candidate: **3.6.50**

## Product Guarantees

- Speed tests are measurement-only. They do not connect, switch the selected node, or enable system proxy/TUN.
- Startup runs one Aegos-managed background first test after runtime and node data are ready.
- System proxy, TUN, and disconnect protection changes use verified transaction and recovery paths.
- Subscription, node, and routing changes are preflighted, applied, verified, and rolled back on failure.
- User-facing status is derived from Aegos runtime snapshots instead of exposing raw core state.
- Ordinary subscriptions show every node; very large lists use complete, scroll-reachable virtualization.
- Diagnostic and exported log data are redacted by default.

## Repository Layout

- `src/`: desktop UI and product interaction state.
- `src-tauri/src/`: Rust control plane, runtime domains, task scheduling, configuration deployment, diagnostics, and Windows takeover.
- `resources/core/`: approved managed Mihomo runtime asset.
- `tools/`: executable product, security, performance, and regression audits.
- `RELEASE_3.6.50.md`: current candidate release notes, verification, installer hash, and known limits.

## Build

Requirements:

- Windows 10/11 x64
- Node.js and npm
- Rust stable with the MSVC target
- Visual Studio C++ Build Tools
- WebView2 runtime

```powershell
npm install
npm run check
npm run build
```

The NSIS installer is written to:

```text
src-tauri/target/release/bundle/nsis/Aegos_3.6.50_x64-setup.exe
```

Build outputs are intentionally excluded from Git. Signed release artifacts belong in GitHub Releases.

## Verification

The release gate includes Rust unit tests plus executable UI, interaction, performance, security, recovery, and installer audits.

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
npm run smoke:interactions
npm run smoke:perf
npm run audit:security
npm run audit:runtime-regression
npm run audit:installer
npm run audit:release
```

The 3.6.50 candidate baseline includes 182 Rust tests, an 89-node complete-list interaction fixture, and an 8,000-node virtual-list and streamed-speed pressure fixture.

## Security

Do not commit real subscription URLs, tokens, node credentials, private keys, diagnostic exports, or local settings. Report files and release notes must contain sanitized fixtures only.

## License Notice

Third-party components retain their original licenses. See `docs/ui/LICENSE_AUDIT.md`, `third_party/`, and the managed core metadata before redistribution.
