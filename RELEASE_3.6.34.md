# Aegos 3.6.34

Startup speed-test and landing-IP regression repair for Windows x64.

## Fixed

- Opening Aegos no longer triggers the generated automatic-selection group to probe every node. Generated and migrated Aegos `url-test` groups now use Mihomo lazy health checks.
- Startup speed preparation remains catalog-only and cannot call batch or single-node speed-test commands.
- Smart/rule mode landing-IP lookup resolves the live `Final -> Proxies -> node` route instead of treating a persisted region group such as `HK` as a real node.
- Global mode landing-IP lookup remains anchored to the live `GLOBAL` route.
- The hidden landing-IP group is validated before selection, synchronization failures are returned instead of swallowed, and stale results are rejected after node, profile, or mode changes.
- Running node snapshots use Controller `now` values as runtime truth; persisted selections are retained only for offline preview.
- Landing-IP failures now map to dedicated Aegos issue codes for disconnected core, route synchronization, stale query, and provider exhaustion.

## Verification

- Rust unit suite passes with 158 tests and 0 failures.
- Startup warm-up audit proves no startup path calls a node speed-test command.
- Smart-mode live Controller validation resolved `Final -> Proxies -> current node`, synchronized `Aegos Landing IP`, and returned a valid public IPv4 address through that node.
- Backend, outbound-IP, speed-reform, security, runtime regression, and interaction gates are required before packaging.
- Runtime closure was rechecked with `npm run audit:runtime-regression`, `npm run audit:installer-regression`, `npm run audit:stability`, and `npm run audit:core-runtime`.

## Limits

- Existing failed delay rows remain visible as historical cache until the user starts a new speed test; they are not evidence of a new startup test.
- Live route verification used the active SS subscription. Other protocols retain the same Controller group-selection path but still depend on provider availability.

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.34_x64-setup.exe`
- Size: `16,092,654` bytes
- SHA-256: `4DBEB982CD0C629B8DADFBBA1E4DE348AE6C13ACDF5A94176B9E9BF4ABC79C8F`
