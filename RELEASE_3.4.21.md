# Aegos 3.4.21

## Scope

3.4.21 is a small stabilization checkpoint after the 3.4.20 maturity candidate.

- Package, Tauri, Cargo, and in-app version labels are aligned to 3.4.21.
- Native browser `prompt`, `confirm`, and `alert` dialogs are banned from production frontend code.
- Strategy group rename, strategy group creation, strategy group deletion, user-rule deletion, and subscription rename now use the unified Aegos app dialog.
- The new dialog keeps edits inside the app surface, preserves optimistic/background-job flows, and avoids blocking page state with browser UI.
- The debt audit now guards against reintroducing native browser dialogs.

## User Value

Users see one consistent interaction model when renaming subscriptions, managing strategy groups, or deleting rules. Destructive actions explain what will happen before the background job runs, and ordinary text edits no longer jump into browser-native prompts.

## Safety

- No proxy switching behavior is changed.
- No speed-test behavior is changed.
- No routing generation behavior is changed.
- The change is limited to frontend interaction surfaces and the debt audit gate.

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
