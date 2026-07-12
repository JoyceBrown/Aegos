# Aegos 3.4.8

IPv4 fallback or block checkpoint.

## Changes

- Unsupported IPv6 now reports fallback or block action.
- Unit coverage confirms fallback does not change connection state.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml ipv6_dns_safety_auto_falls_back_without_connection_changes`
- `npm run audit:ipv6-dns-safety`

## Artifact

Source-only checkpoint. SHA-256: Source-only
