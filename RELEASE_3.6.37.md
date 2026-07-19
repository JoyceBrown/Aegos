# Aegos 3.6.37 Candidate

## Added

- Manual-node editing now keeps the modern protocol fields required for VLESS Reality, Hysteria2, TUIC, and AnyTLS: SNI, flow, client fingerprint, Reality public key/short ID, obfuscation, obfuscation password, and certificate-verification choice.
- Reality options are persisted into the runtime YAML while Aegos-only editor metadata remains excluded from the runtime configuration.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml`: 162 passed.
- `npm run check` and `npm run audit:backend`: passed.
- Local no-takeover installer path: silent install to a project-local directory, standby launch, and silent uninstall passed. FlClash remained running and the existing Windows proxy stayed on `127.0.0.1:7890`.

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.37_x64-setup.exe`
- Size: `16,103,650` bytes
- SHA-256: `00697B01677B250A61F61443C394FB33AB5EFAED8025E37CE83025F805676130`

## Candidate Limits

- This is a candidate, not a published release. No tag, upload, or distribution action has been performed.
- Active TUN, firewall, system-proxy takeover, and real external protocol connection paths remain deferred so the active FlClash network is not interrupted.
