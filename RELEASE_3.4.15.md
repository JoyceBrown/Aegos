# Aegos 3.4.15

Source-only checkpoint. No installer is produced for this small version.

## Product Work

- Made outbound IP lookup states explicit on the home page: pending, success, stale cancellation, and failure.
- Auto outbound IP lookup failure now shows `查询失败` instead of silently keeping an old IP as if it were current.
- Added title text to outbound IP fields so the failure detail is available without adding noisy UI.
- Added a home product audit for first-screen state, quick actions, default common region, truthful metrics, and shared speed-result rendering.

## Safety

- Outbound IP updates remain request-sequenced. Old requests cannot overwrite newer node/profile state.
- Home keeps high-frequency actions only and avoids low-value quick actions.
- LAN IP, system proxy, current node, latency, stability, active connections, last speed test, traffic, and outbound IP remain visible from the first screen.

## Verification

- `node --check tools/home-product-audit.js`
- `npm run audit:home-product`
- `npm run audit:outbound-ip`
- `npm run audit:responsiveness`
- `npm run smoke:interactions`
- `npm run audit:stability`
- `npm run audit:product-maturity`
- `npm run audit:release`
- `npm run check`
- `git diff --check`

## Artifact

Source-only. SHA-256: N/A.
