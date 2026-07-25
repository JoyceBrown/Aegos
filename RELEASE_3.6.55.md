# Aegos 3.6.55

## Scope

- Keep startup connectivity measurement while preventing it from competing
  with foreground connection, TUN, subscription, and navigation work.
- Make TUN state describe verified traffic takeover instead of a saved
  preference.
- Reduce visible subscription noise and shorten connection shutdown paths.

## Changes

- Startup speed testing now waits for the first screen to settle. Foreground
  runtime operations cancel a pending or active automatic test, and the test is
  rescheduled only after the app becomes idle.
- Duplicate speed-runtime preparation is removed. Rules prefetch and node-page
  prerendering also yield to user operations and active measurement work.
- Home and Settings distinguish `连接时启用`, `已接管`, and `未启用`.
  Single-setting and batch-setting updates use verified traffic takeover when
  reporting the active TUN state.
- Changing TUN while connected first uses a runtime hot reload. A bounded
  restart remains as a fallback only when the live reload cannot be verified.
- Disconnect skips Windows proxy restoration when Aegos did not take over the
  system proxy. A cleanly stopped managed core also skips the next-launch
  orphan-process scan.
- TUN connectivity verification uses a short Cloudflare-first probe sequence
  to avoid waiting on slow Microsoft endpoints.
- Subscription rows retain the decision-critical state and actions while
  removing raw timestamps, empty traffic metadata, `尚未检测`, and duplicate
  visible commands. Secondary operations remain available from the overflow
  menu.
- The subscription action column remains stable at compact and high-DPI
  layouts, including five-row pressure fixtures.
- Release performance fixtures model 480 ordinary nodes and 800 stress nodes.
  Soak baselines begin after the first delay cache is established, so normal
  cache creation is not reported as a leak.

## Verification

- 189 Rust unit tests passed.
- Backend, stability, core-runtime, runtime-regression, security, control-plane,
  takeover, responsiveness, speed-reform, and release audits passed.
- Full interaction smoke passed, including automatic speed-test cancellation
  before foreground runtime operations.
- UI smoke passed at supported viewports and 125%, 150%, 175%, and 200% DPI,
  including five subscription rows without overflow or wrapped commands.
- 480-node performance, 800-node stress, 16-cycle soak, and product-journey
  evidence passed.
- FlClash was not stopped or modified during development, testing, or
  packaging.

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.55_x64-setup.exe`
- Size: `16210906` bytes
- SHA-256: `74434bb09abb37dbd3a345f3cbdb0e94bb638874e9f27ca9abb05f9af2f3f467`
- Signature: unsigned open-source build

## Known Limits

- The installer is not Authenticode-signed, so Windows may show a reputation
  warning until a trusted signing certificate is configured.
- Real-device long-duration stability is not used as a release blocker on the
  current resource-constrained test host; deterministic stress and soak gates
  remain mandatory.
