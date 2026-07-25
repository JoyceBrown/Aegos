# Aegos 3.6.56

## Scope

- Make the rules page responsive immediately after startup measurement begins.
- Replace rules and settings dashboards with task-focused, low-noise workspaces.
- Preserve all existing website, application, system-rule, takeover, DNS,
  security, recovery, system-check, and advanced-setting capabilities.

## Changes

- Entering Rules now paints the editor first. If the automatic startup speed
  test is active, Aegos cancels it before loading the rules snapshot and
  schedules a replacement measurement after the foreground work is idle.
- Startup rules prefetch moves from 1.4 seconds to 9 seconds and yields to
  foreground work, background jobs, and active measurement.
- The low-value four-cell rules dashboard and preview badge are removed.
  Website, application, and system rules now use a vertical task selector with
  one visible workspace at a time.
- Website and application rule controls form one clear operation row:
  target, handling method, concrete route, scope, and draft action.
- System rules are grouped as outlet detection, local services, and leak
  protection. Engineering rule tables remain collapsed and paged.
- The settings overview dashboard is removed. Settings are organized into
  Takeover, DNS, Security, Automatic Recovery, System Check, and Advanced
  categories, with one visible category at a time and no backend call on
  category changes.
- Responsive layouts were verified from 920x640 through 1700x900 and at
  100%, 125%, 150%, 175%, and 200% device scale.

## Verification

- 189 Rust unit tests passed.
- Syntax, interaction, UI, responsiveness, stability, routing UX, routing
  product, settings security, architecture, copy, Stage 7 visual, and release
  gates passed.
- The complete product smoke passed with all ten ordinary-user journeys and
  zero forbidden side effects: `npm run smoke:product`.
- The 800-node pressure run completed 420 rapid page changes with 0.30ms
  navigation P95. Cold routing content was ready in 220.2ms.
- Three repeated cold runs kept Cold routing at or below 222.4ms.
- Windowed GPU navigation stayed at 33.5ms P95 and 66.8ms maximum on the
  current 30Hz compositor.
- The 16-cycle soak completed 277 mixed commands with stable DOM and timer
  counts.
- Performance evidence was checked with
  `npm run audit:stage8-performance`.
- Current mainline evidence for `3.5.71 - 3.6.40` was checked with
  `npm run audit:current-mainline` and
  `cargo check --manifest-path src-tauri/Cargo.toml`.
- FlClash was not stopped, restarted, or modified.

## Evidence

- `PERFORMANCE_PRESSURE_3.6.56.json`
- `PERFORMANCE_GPU_3.6.56.json`
- `PERFORMANCE_REPEAT_3.6.56.json`
- `PERFORMANCE_SOAK_3.6.56.json`
- `PRODUCT_SMOKE_3.6.56.json`

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.56_x64-setup.exe`
- Size: `16220520` bytes
- SHA-256: `810b81d46ca05ceac307c00f54902e09f2b124f7804958e102e2fc7190246c3f`
- Signature: unsigned open-source build

## Known Limits

- Real airport connectivity is not simulated by deterministic test fixtures.
  Existing user validation remains the real-network acceptance source.
- The installer is not Authenticode-signed, so Windows may show a reputation
  warning until a trusted signing certificate is configured.
- Real-device long-duration stability is not a release blocker on the current
  resource-constrained host; deterministic pressure, repeat, Windowed GPU,
  soak, and product-journey gates remain mandatory.
