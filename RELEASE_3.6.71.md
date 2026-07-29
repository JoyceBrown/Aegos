# Aegos 3.6.71

Status: local unsigned candidate built and payload-verified. This version is
not installed, published, committed, pushed, signed, or offered through an
updater.

This candidate is allocated only to add complete project and third-party
license materials to the immutable published v3.6.70 baseline. It does not
replace or mutate the `v3.6.70` tag, release, source, or installer asset.

## Scope

- Aegos declares `GPL-3.0-only` in its root, npm, Cargo, and Tauri metadata.
- The unmodified official GNU GPL version 3 text is included for Aegos.
- The managed Mihomo executable is fixed to upstream `v1.19.28`, tag commit
  `cbd11db1e13a75d8e680e0fe7742c95be4cba2be`, official Windows amd64 v1
  archive, archive SHA-256, executable SHA-256, GPLv3 text, and corresponding
  source link.
- `THIRD_PARTY_NOTICES.md` and the complete locked Windows x64 Rust
  normal/build dependency license aggregation are generated deterministically.
- Aegos, Mihomo, Fluent icon, NOTICE, provenance, and Rust license materials
  are mapped into the application resource directory under `licenses/`.
- Missing, stale, or tampered licensing inputs fail closed, and known-bad
  fixtures prove each material failure path.

## Verification

The final LIC-01 record at `docs/work/license-packaging-lic01.md` must contain
fresh commands, UTC times, exit codes, Git baseline and dirty-worktree summary,
the complete host-safe acceptance matrix, artifact identity, signature status,
and direct inspection evidence for every required file inside the actual NSIS
payload. Static configuration alone is not payload evidence.

The verification must not install or launch Aegos, change Windows proxy, TUN,
DNS, firewall, kill-switch, or host networking, or stop/restart/reconfigure
FlClash.

The unchanged runtime recovery baseline remains release-blocking through:

- `npm run audit:runtime-regression`
- `npm run audit:installer-regression`
- `npm run audit:stability`
- `npm run audit:core-runtime`

License closure additionally requires `npm run audit:licenses` and
`npm run audit:licenses-fixtures`.

## License payload

The candidate must contain these application resources:

- `licenses/AEGOS-GPL-3.0.txt`
- `licenses/THIRD_PARTY_NOTICES.md`
- `licenses/MIHOMO-GPL-3.0.txt`
- `licenses/MIHOMO-SOURCE.md`
- `licenses/MIHOMO-PROVENANCE.json`
- `licenses/FLUENT-UI-SYSTEM-ICONS-MIT.txt`
- `licenses/RUST-THIRD-PARTY-LICENSES.txt`
- `licenses/RUST-LICENSE-EXCEPTIONS.md`

## Artifact

- Expected NSIS name: `Aegos_3.6.71_x64-setup.exe`
- Expected local path:
  `src-tauri/target/release/bundle/nsis/Aegos_3.6.71_x64-setup.exe`
- Size: 16,399,892 bytes
- SHA-256: `a3215fbdc3f08db76c57ab193cf8ef7b4aabd1236518697785d2788fa52bc887`
- Signature: unsigned (`Get-AuthenticodeSignature` returned `NotSigned`)
- Distribution: local-only; installation and publication are excluded
