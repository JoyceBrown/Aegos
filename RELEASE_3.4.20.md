# Aegos 3.4.20

## Scope

3.4.20 is the whole-product maturity candidate for the 3.4.11 to 3.4.20 recovery lane.

- Package, Tauri, Cargo, and in-app version labels are aligned to 3.4.20.
- The candidate must pass product, security, stability, responsiveness, routing, diagnostics, settings, subscription, and installer gates before delivery.
- The installer is produced only after the full gate set passes.
- Rules page now separates strategy groups, user rules, and system rules into user-facing workbenches. Strategy groups and Aegos user rules can be added, edited, and deleted through background jobs; system rules are visible with explanations and remain read-only.
- Large node-list rendering is bounded during navigation, filters, and speed tests so routing and node interactions stay responsive even with very large subscriptions.
- Node page strategy groups now recursively resolve referenced groups, so groups such as Disney -> Proxies show their real selectable nodes instead of 0 nodes.
- Node page strategy cards are compact fixed-width cards with horizontal wheel scrolling, right-click management, and drag sorting mode.
- Node page strategy member editing now uses a visual node picker with country/region tags instead of comma-separated text input.
- Deleting a strategy group now safely migrates rules that pointed to it back to Proxies before deletion, preserving valid routing targets.
- Rules page now opens on user rules instead of noisy system internals; strategy-group editing is directed to the node page so users do not edit the same concept in two places.
- Node page target-site management now uses a visual editor instead of browser prompt text input. User rules can be added/deleted, while subscription and system rules remain visible but read-only.
- Diagnostics now includes a lightweight recent-key-log preview so diagnosis and log review share one troubleshooting path without blocking navigation.
- Empty fallback node previews no longer disappear when no real subscription data is loaded.
- Subscriptions that only provide custom groups such as Spotify, Steam, Telegram, region groups, or service groups now get a normalized `Proxies` all-node group and an `自动选择` url-test group.
- The same group normalization is applied both to generated runtime configs and live controller snapshots, so node-page strategy cards stay consistent after startup and subscription switching.
- Node page no longer duplicates `自动选择`: when the backend or subscription already exposes an auto-select group, the frontend does not synthesize a second one, and the real auto-select group stays next to `Proxies`.
- Rules page no longer shows two competing add-rule surfaces: user rules are now a view/edit/delete workbench, while new rules are created through the safer draft, verify, and apply assistant.

## User Value

Users can test this build as a complete Aegos proxy-client candidate: import and switch subscriptions, connect and disconnect, run speed tests without accidental switching, choose nodes, inspect outbound IP, run diagnostics, export logs, verify settings, and operate the base rules and strategy-group workflows.

## Safety

- No new proxy switching behavior is introduced in this candidate note.
- Speed tests remain measurement-only and must not connect or switch nodes.
- Diagnostics, settings checks, and speed tests must not lock navigation or make other pages unusable.
- Logs and exported diagnostics must keep sensitive subscription, token, UUID, password, local path, and IP details redacted according to the existing audit gates.

## Verification

Passed:

- `npm run check`
- all non-installer `audit:*` gates except the post-build `audit:installer` / `audit:release` pair, 51 gates total
- `npm run audit:product-maturity`
- `npm run audit:connection-closure`
- `npm run audit:node-speed-product`
- `npm run audit:subscription-product`
- `npm run audit:home-product`
- `npm run audit:routing-product`
- `npm run audit:diagnostics-product`
- `npm run audit:settings-security-product`
- `npm run audit:global-interaction-product`
- `npm run audit:security`
- `npm run audit:responsiveness`
- `npm run audit:stability`
- `npm run audit:diagnostics`
- `npm run audit:node-strategy-ui`
- `npm run audit:installer-regression`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run smoke:ui`
- `npm run smoke:soak`
- `git diff --check`
- `npm run build`
- `npm run audit:installer`
- `npm run audit:release`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.4.20_x64-setup.exe`
- Size: 15,539,559 bytes

SHA-256: 23718ED7B25352FF1DCEEE797A49825536D8FD5B130B0AD2E927C00645813D3B
