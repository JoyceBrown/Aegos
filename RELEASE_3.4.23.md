# Aegos 3.4.23

3.4.23 is a small interaction polish checkpoint for the Nodes strategy-group workflow.

## Changes

- Package, Tauri, Cargo, and in-app version labels are aligned to 3.4.23.
- Grouped the Nodes-page strategy-group context menu into strategy, routing, and layout actions.
- Clarified locked behavior for the automatic-select view so users do not try to edit it as a real group.
- Added a target-site summary area with user-rule count, read-only-rule count, and priority explanation.
- Added in-app confirmation before deleting a target-site rule.
- Fixed the first-open context menu path so the menu is created before it is read.

## Verification

- `node --check src/app.js`
- `node --check tools/node-strategy-ui-audit.js`
- `npm run check`
- `npm run audit:debt`
- `npm run audit:copy`
- `npm run audit:node-strategy-ui`
- `npm run audit:routing-product`
- `npm run audit:product-maturity`
- `npm run audit:global-interaction-product`
- `npm run audit:release`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run smoke:ui`
- `git diff --check`

## Artifact

- Source-only checkpoint.
- SHA-256: Source-only.
