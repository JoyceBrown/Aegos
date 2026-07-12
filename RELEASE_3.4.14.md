# Aegos 3.4.14

Source-only checkpoint. No installer is produced for this small version.

## Product Work

- Unified subscription mutation refresh through one `refreshProfileSurfaces` path for import, update, switch, and remove.
- Added profile-scoped UI invalidation so stale node refreshes cannot overwrite the newly selected subscription.
- Queued forced node refreshes when an old refresh is in flight, preventing `nodeBusy` from swallowing the new subscription refresh.
- Subscription switching now invalidates old outbound IP lookups and refreshes outbound IP again when connected.
- Kept local subscription preview and fade transition so switching subscriptions does not blank or flash the node list.

## Safety

- Bad subscription import/update paths still use diagnostic classification and rollback.
- Old speed tests, node previews, node refreshes, and outbound IP queries are profile-scoped.
- Subscription URL/token handling remains covered by existing diagnostics and release gates.

## Verification

- `node --check tools/subscription-product-audit.js`
- `npm run audit:subscription-product`
- `npm run audit:subscription`
- `npm run audit:subscription-fixtures`
- `npm run audit:node-flow`
- `npm run audit:responsiveness`
- `npm run audit:stability`
- `npm run audit:product-maturity`
- `npm run audit:release`
- `npm run check`
- `git diff --check`

## Artifact

Source-only. SHA-256: N/A.
