# Aegos 3.1.1

Source checkpoint for the routing page entry, deferred loading, and page cache
contract.

## Changes
- Added `audit:routing-navigation` to lock the routing page into the same
  non-blocking navigation model as the existing pages.
- Added routing coverage to the rapid navigation performance smoke test.
- Added routing coverage to the interaction smoke test, including immediate
  pointerdown activation, stale load cancellation, read-only badge visibility,
  and quiet-period rendering.
- Kept routing data loading read-only, token guarded, and detached from
  foreground UI busy state.
- Tightened large-list rendering budgets for the first-screen summary path and
  updated the performance smoke long-task budget to prioritize real input
  latency plus severe task spikes.
- Bumped package, Tauri, Cargo, and sidebar versions to 3.1.1.

## Verification
- `npm install --package-lock-only --ignore-scripts`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run audit:routing-navigation`
- `npm run audit:routing-readonly`
- `npm run audit:architecture`
- `npm run audit:release`
- `npm run audit:security`
- `npm run audit:speed`
- `npm run audit:responsiveness`
- `npm run audit:stability`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run check`
- `git diff --check`

## Artifact
- Source checkpoint: no installer built for this checkpoint.
- SHA-256: Source-only
