# Aegos 3.6.24

## Diagnostics repair center

- Merged Diagnostics and Logs into one user workflow.
- `Problem diagnosis` is the default view; `Runtime logs` are rendered only when opened.
- Removed the standalone Logs sidebar entry and duplicate recent-log preview.
- Diagnosis and repair remain background tasks, so navigation and read-only pages stay usable.
- Corrected unrelated operation messages that previously claimed a diagnostic export had failed.
- Replaced mojibake background-job labels with readable product language.

## Verification

- Stage 6 audit covers every checkpoint from 3.6.17 through 3.6.24.
- Interaction smoke covers diagnosis, navigation during diagnosis, internal logs, filters, export, and repair jobs.
- Rust tests cover issue privacy, repair allowlisting, failure classification, and support-report redaction.
- The carried `3.5.71 - 3.6.40` mainline remains authoritative, including the `3.5.86` non-blocking pressure contract.
- Carried Stage 4 configuration deployment and Stage 5 Windows takeover gates remain mandatory.

Commands used for release verification:

```text
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run smoke:interactions
npm run smoke:perf
npm run audit:current-mainline
npm run audit:phase2-pressure
npm run audit:config-deployment
npm run audit:system-takeover-stage5
npm run audit:diagnostics-stage6
npm run audit:runtime-regression
npm run audit:installer-regression
npm run audit:stability
npm run audit:core-runtime
npm run audit:stage2-closure
npm run audit:takeover
```

## Remaining risk

- TUN and firewall repairs still require administrator permission on Windows.
- Real recovery outcomes depend on the local Windows policy, third-party security software, and subscription provider availability; failures remain visible and do not silently claim success.

## Artifact

- Path: `src-tauri/target/release/bundle/nsis/Aegos_3.6.24_x64-setup.exe`
- Size: `15,858,960 bytes`
- SHA-256: `ad728aa6ff913d6a43b5487eeb779b01dd84f05e4104351bd85c21ec5625ad4b`
