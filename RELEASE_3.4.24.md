# Aegos 3.4.24

3.4.24 is a packaged interaction-polish checkpoint for the Nodes strategy-group and target-site workflow.

## Changes

- Package, Tauri, Cargo, and in-app version labels are aligned to 3.4.24.
- Target-site editing now checks duplicate user rules before writing.
- Target-site editing warns when a new user rule will override an existing subscription rule.
- Added live input guidance for target-site rules.
- Added non-submitting example chips for common website-rule inputs.
- Tightened the node strategy UI audit so duplicate checks and live examples cannot regress silently.

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
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run smoke:ui`
- `git diff --check`
- `npm run build`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.4.24_x64-setup.exe`
- Size: 15,545,289 bytes
- SHA-256: BF10712863C096A0075C4C212FE917D570EF7DB30F7A9D0ED30A9B55107A0DE3
