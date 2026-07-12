# Aegos 3.4.13

Source-only checkpoint. No installer is produced for this small version.

## Product Work

- Hardened node speed-test result propagation with a backend `resultSignature`, so home and node pages refresh when delay, failure reason, or tested-at metadata changes.
- Kept one-click, batch, and single-node speed tests measurement-only. They do not switch nodes, modes, system proxy, TUN, or traffic takeover.
- Added clearer failure classes for blocked and unreachable nodes, and kept failed tests visible as status reasons instead of collapsing back to untested.
- Ensured single-node timeout writes a visible row failure state immediately, so the row does not stay stuck in testing.

## Safety

- Speed-test state remains run-id scoped.
- Subscription/profile switching still clears stale speed state and prevents old results from polluting the new subscription.
- DIRECT, strategy groups, airport metadata rows, and fake-ip targets remain excluded from ordinary speed tests.

## Verification

- `node --check tools/node-speed-product-audit.js`
- `npm run audit:node-speed-product`
- `npm run audit:speed`
- `npm run audit:speed-target`
- `npm run audit:responsiveness`
- `npm run audit:stability`
- `npm run audit:product-maturity`
- `npm run audit:release`
- `npm run check`
- `git diff --check`

## Artifact

Source-only. SHA-256: N/A.
