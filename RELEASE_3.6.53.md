# Aegos 3.6.53

## Scope

- Preserve the startup measurement-only speed test so every launch verifies
  that the current node set is usable without switching the selected node.
- Improve visible subscription, fixed-node, routing, diagnostics, and
  small-window behavior.
- Continue reducing legacy control-plane ownership without duplicating Mihomo
  inside Aegos.

## Changes

- Subscription cards now show node, strategy-group, rule, format, update,
  traffic, and expiry information when the source provides it.
- Remote subscription addresses can be replaced transactionally. The new
  source is downloaded, parsed, compiled, and runtime-validated before the
  stored address changes; stale downloads and oversized responses are rejected.
- Local YAML and text subscriptions can be imported through the same guarded
  deployment path.
- Non-active subscriptions can be preflighted without switching the active
  subscription or selected node.
- Landing-IP lookup races six HTTPS providers within a 3.2-second budget.
  Temporary failures retain a visibly stale cached value instead of reporting
  it as fresh.
- Fixed-node right-click actions keep a stable menu shell while relay-group
  data hydrates in place. The opening transition no longer scales text, and
  reduced-motion preferences remain respected.
- Rules-page DOM construction now lives in `src/routing-ui.js`; `app.js`
  retains state, events, and backend coordination through a single UI factory.
- User-visible backend copy for port selection, direct diagnostics, profile
  naming, and built-in profile protection is valid UTF-8 Chinese.
- The application minimum window is 980 x 640, with verified layout across
  supported viewport sizes and DPI scales.
- Only the all-subscriptions update remains cancellable. Other tasks reject
  unsafe cancellation, and cancelled jobs cannot later become successful.

## Verification

- 189 Rust unit tests
- JavaScript syntax checks for the application and routing UI module
- Full interaction smoke, including exactly one startup speed test with no
  connection or node-selection changes
- UI smoke across 980 x 640 through 1700 x 900 and 1.0 through 2.0 DPI
- Backend, subscription product/runtime, landing-IP, routing, UI architecture,
  copy encoding, and release audits
- FlClash was not stopped or modified during development and validation

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.53_x64-setup.exe`
- Size: `16213663` bytes
- SHA-256: `c841685f7b2dd7c0384d47058ae1fb78b36c9186f91dc4078e655f4ec72e4d2a`
