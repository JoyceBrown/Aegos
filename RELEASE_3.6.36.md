# Aegos 3.6.36 Candidate

## Fixed

- Startup now recovers an orphaned Mihomo process only when its normalized executable path exactly matches the Aegos-managed core path. It never removes an unrelated process merely because it is named `mihomo`.
- The recovery runs before runtime-port preparation. If Windows cannot complete the scoped recovery, Aegos reports startup failure instead of creating another core process.
- Outbound-IP background results now require matching query generation, active profile, mode, and selected proxy before updating the visible cache.
- DNS now has explicit Auto, Secure takeover, System DNS, and Custom encrypted-resolver policies. System DNS cannot combine with TUN or DNS hijacking; Secure takeover forces DNS hijacking for TUN.
- Mainline, core-runtime, installer-regression, and speed-target audits now validate behavior contracts rather than stale source-text assumptions.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`: 161 passed.
- `npm run check`, runtime/security/backend/outbound-IP/installer-regression gates, configuration and subscription gates passed.
- `npm run audit:runtime-regression`, `npm run audit:installer-regression`, `npm run audit:stability`, and `npm run audit:core-runtime` passed.
- Development Windows recovery path: force-terminating Aegos left one managed core; the next start removed it before startup and did not leave a duplicate managed core.
- Controlled Windows installer path: the 3.6.36 NSIS installer completed successfully, the installed version reported `3.6.36`, and an administrator restart after forced termination replaced one stale managed core with one new managed core. The run ended with no Aegos or Mihomo test process remaining.
- User-approved local no-takeover path: installed to an isolated project-local directory, started only to the standby UI, force-terminated and restarted, then silently uninstalled. No Mihomo process was started, and FlClash plus the existing `127.0.0.1:7890` system-proxy baseline remained unchanged throughout.

## Candidate Limits

- This file describes a candidate, not a published release.
- The no-takeover local path does not cover active TUN, firewall, or system-proxy takeover; those scenarios remain deferred to a run that does not interrupt the active FlClash network.
- Missing-WebView2, active TUN/firewall takeover, competing-VPN, and multi-device matrices remain required before release.
- The executable protocol and Windows evidence checklist is `VALIDATION_MATRIX_3.6.36.md`.
- Publication is additionally blocked on the license and distribution checkpoints recorded in `DISTRIBUTION_REVIEW_3.6.36.md`; this candidate is not approved for redistribution.

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.36_x64-setup.exe`
- Size: `16,103,435` bytes
- SHA-256: `623D7D374D329886398E55E96F9D809EFFAFA4B2125B606825290F7C2680124A`
