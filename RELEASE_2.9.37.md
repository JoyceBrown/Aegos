# Aegos 2.9.37

## Focus

- Align batch speed testing closer to the audited FlClash behavior: fast first response, high concurrency, and incremental results.
- Keep speed tests measurement-only: never switch, connect, or change the current node.
- Make startup and subscription switching show node rows sooner and with less flicker.
- Keep the UI usable while slow or failed nodes are still being tested.

## Changes

- Batch speed tests now use a FlClash-style first pass: `https://www.gstatic.com/generate_204`, 5 second timeout, and 100-node batches for the broad pass.
- Single-node tests still keep the deeper retry path, so diagnostics can be more thorough without slowing normal batch tests.
- Speed progress now streams only completed node results instead of pre-filling every node as `0ms`, which prevents slow nodes from making the whole list look stuck in testing.
- Frontend speed result merging now uses a node index and patches only changed nodes, instead of remapping the full node list on each poll.
- Home and node pages continue to share the same speed state, so the quick one-click test and node page batch test stay synchronized.
- Startup now previews the active profile's local nodes before the verified controller refresh finishes.
- Subscription switching keeps the previous list visible during the local preview transition, avoiding a blank flash or harsh page jump.
- The node page header now exposes the shared `切换订阅` menu, reusing the same profile menu logic as the home quick action.
- Release audit now checks the real speed polling threshold instead of a stale hardcoded value.

## Verification

- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `npm run check`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `npm run audit:backend`
- `npm run audit:security`
- `npm run audit:speed`
- `npm run audit:node-flow`
- `npm run audit:subscription`
- `npm run audit:subscription-fixtures`
- `npm run audit:outbound-ip`
- `npm run audit:diagnostics`
- `npm run audit:responsiveness`
- `npm run audit:takeover`
- `npm run audit:architecture`
- `npm run audit:debt`
- `npm run smoke:interactions`
- `npm run smoke:ui`
- `npm run smoke:perf`
- `npm run smoke:soak`
- `npm run audit:release`
- `npm run build`

## Artifact

- Path: `src-tauri/target/release/bundle/nsis/Aegos_2.9.37_x64-setup.exe`
- SHA-256: `4c5a65fb1e3f86a75b901974447c35c20a307d4b61c0f037632c25642b9b58f0`
