# Aegos 3.4.22

## Scope

3.4.22 is a small product-structure stabilization checkpoint.

- Package, Tauri, Cargo, and in-app version labels are aligned to 3.4.22.
- Rules page no longer carries the old strategy-group edit form, submit path, or delete path.
- Node page is now the only strategy-group management surface for rename, member selection, target-site management, creation, deletion, and sorting.
- Rules page strategy-group section is a read-only overview with a clear jump to node-page management.
- Routing product audit now guards this boundary so the old two-page strategy-group editing model cannot silently return.

## User Value

Users no longer need to guess whether strategy groups should be edited in Rules or Nodes. Rules chooses traffic direction; Nodes manages strategy groups and nodes.

## Safety

- No proxy switching behavior is changed.
- No speed-test behavior is changed.
- No routing draft generation behavior is changed.
- Backend strategy-group edit capability remains available for the node page.

## Verification

Passed:

- `node --check src/app.js`
- `npm run check`
- `npm run audit:debt`
- `npm run audit:copy`
- `npm run audit:routing-product`
- `npm run audit:node-strategy-ui`
- `npm run audit:product-maturity`
- `npm run audit:global-interaction-product`
- `npm run audit:release`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run smoke:ui`

## Artifact

Source-only checkpoint. Installer will be produced after the requested test checkpoint or the next package gate.

SHA-256: Source-only
