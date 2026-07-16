# Aegos 3.6.31

Source-only maturity checkpoint. No installer is published for this intermediate version.

## Plan item

Stage 8 / 3.6.31: complete product smoke based on ordinary-user journeys rather than file-presence checks.

## Implemented

- Added structured journey evidence for startup truth, TUN-off and TUN-on connection paths, measurement-only speed testing, node/outbound-IP synchronization, subscription lifecycle, rule preview/verification/application, diagnostics repair/export, settings, and background operations.
- Added explicit forbidden-side-effect evidence for speed-triggered proxy switches and standby speed-triggered connections.
- Added a real browser product-smoke runner that executes the existing interaction path once and validates its returned evidence.
- Added a Stage 8 gate that requires the runner, evidence contract, carried Stage 1-7 audits, and release record.
- Expanded the authoritative mainline with the detailed 3.6.31-3.6.40 maturity sequence.

## Acceptance

Required commands:

```text
npm run smoke:product
npm run audit:stage8-product-smoke
npm run smoke:ui
npm run smoke:perf
npm run smoke:soak
cargo test --manifest-path src-tauri/Cargo.toml
```

## Verification

- The authoritative `3.5.71 - 3.6.40` mainline remains carried by this checkpoint.
- `PRODUCT_SMOKE_3.6.31.json` records ten completed user journeys, 134 command observations, no missing commands, and zero forbidden side effects.

Verification commands also include:

```text
cargo check --manifest-path src-tauri/Cargo.toml
npm run audit:current-mainline
npm run audit:stage7-visual
npm run audit:ui-architecture
npm run audit:release
```

## Limits

- Browser smoke uses sanitized deterministic runtime fixtures; it proves UI orchestration, command intent, state reconciliation, and forbidden side effects.
- Real airport connectivity and protocol interoperability remain assigned to 3.6.37 and are not claimed by this checkpoint.

## Artifact

- Source-only checkpoint; no `3.6.31` installer is published.
- SHA-256: not applicable to a source-only checkpoint.
