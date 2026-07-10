# Aegos 2.2.0

## Highlights

- Reorganize the Settings page into runtime summary, proxy takeover, security/network, reliability, and advanced runtime sections.
- Add live settings summaries for permission state, mixed/controller ports, takeover state, system proxy, and reliability strategy.
- Keep advanced settings in the existing background job flow while making the UI easier to scan and safer to operate.
- Preserve port isolation from FlClash/Codex by keeping the default mixed port at 7891.
- Promote this checkpoint to a medium-version installer build.

## Verification

- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `npm run check`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run smoke:ui`
- `npm run audit:backend`
- `npm run audit:release`
- `npm run build`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_2.2.0_x64-setup.exe`
- SHA-256: 23f936b4ca89eae02bcd88f0ed55bdf3b40e9f1582e8dc955036721ad5db53b1
