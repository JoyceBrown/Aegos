# Aegos 0.5.4

## Fixes

- Made core startup fail fast when mihomo exits before the controller is ready.
- Prevented system proxy setup failure from masking a successful core start.
- Updated remote subscriptions in place instead of creating duplicate profiles.
- Applied active subscription switches to a running core by restarting with the selected profile.
- Reduced blocking status, traffic, connection, and delay-test timeouts.
- Added visible busy states and error feedback for connection, subscription, proxy, TUN, restart, and connection-management actions.
- Bound previously inert node-page controls including batch delay test and node search.

## Verification

- `node --check src\app.js`
- `npm run smoke:ui`
- `npm run smoke:interactions`
- `npm run audit:release`
- `cargo test --manifest-path src-tauri/Cargo.toml parses_base64_tuic_subscription`
