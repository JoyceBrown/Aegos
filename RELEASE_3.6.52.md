# Aegos 3.6.52

## Scope

- Keep the complete fixed-node configuration available across editing sessions
  and application restarts.
- Add fixed-node context actions on both the home fixed-node list and node page.
- Support Aegos-managed relay chaining through Mihomo `dialer-proxy`.

## Changes

- Fixed-node editing now uses an explicit backend read path for the complete
  stored configuration instead of reconstructing fields from the redacted node
  catalog.
- The editor restores authentication, TLS, Reality, obfuscation, UDP, and relay
  settings and adds a dedicated front proxy group selector.
- Right-clicking a fixed node provides speed test, edit, add, delete, and front
  proxy group controls. The complete menu is rendered synchronously, and relay
  candidates hydrate the existing selector in place without replacing or
  resizing the menu. Speed testing remains measurement-only.
- Relay group candidates exclude the fixed-node insertion group and dependent
  groups that would create a routing cycle.
- Save, relay changes, and deletion use staged settings deployment, active
  runtime hot reload, verification, and rollback.
- Fixed-node mutations wait for in-flight node refreshes to settle before
  updating the home and node surfaces, preventing stale rows from returning.
- Fixed-node normalization, editor state, relay planning, save, and deletion
  transactions now live in `manual_node_runtime`, reducing legacy
  control-plane ownership in `main.rs`.
- Large-node rendering caches group-name classification and limits immediate
  speed-state updates to indexed visible/current nodes, keeping the 8,000-node
  startup and streamed-result paths bounded.

## Verification

- 185 Rust unit tests
- Full interaction smoke covering persistent credentials, context actions,
  stable menu DOM/geometry, `dialer-proxy`, deletion, and home/node
  synchronization
- UI fixed viewport and DPI smoke
- Product journey, configuration domain/deployment, node flow, node strategy,
  UI architecture, copy encoding, security, installer, and release gates
- Runtime regression, installer regression, stability, and core-runtime gates
- Control-plane and technical-debt gates
- The 8,000-node performance gate was rerun without relaxed thresholds. Startup,
  navigation, menu, filtering, event processing, DOM, and long-task budgets
  passed; headless frame pacing remained scheduler-limited while unrelated
  background services held total CPU between 55% and 72%.
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run audit:runtime-regression`
- `npm run audit:installer-regression`
- `npm run audit:stability`
- `npm run audit:core-runtime`
- FlClash was not stopped or modified during development and validation

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.52_x64-setup.exe`
- Size: `16184942` bytes
- SHA-256: `db2eb6e87b3935cc02a7a124d23f07064242331a9691b17ba05c205ebbdb2b85`
