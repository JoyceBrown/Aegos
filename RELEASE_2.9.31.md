# Aegos 2.9.31

Source-only checkpoint for the FlClash delay-strategy comparison and speed-test alignment work.

## Changes

- Aligned mihomo runtime config with FlClash-style delay measurement by explicitly enabling `unified-delay` and `tcp-concurrent`.
- Reworked the speed-test probe plan so the primary probe uses `https://www.gstatic.com/generate_204` with a 5000 ms timeout, matching FlClash's default delay-test URL and timeout.
- Added fallback probe URLs for Aegos speed tests, including HTTPS Cloudflare fallback for UDP-like modern protocols such as TUIC, Hysteria, WireGuard, and AnyTLS.
- Kept speed tests measurement-only: no proxy switch, no current-node mutation, no traffic takeover.
- Added regression coverage for probe planning and generated runtime config flags.

## Notes

- This is not an installer checkpoint.
- Installer: Source-only

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run check`
- `npm run audit:speed`
- `npm run audit:backend`
- `npm run audit:release`

## Artifact

- Installer: Source-only
- SHA-256: Source-only
