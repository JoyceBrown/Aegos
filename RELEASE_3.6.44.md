# Aegos 3.6.44 candidate

## Delivered functionality

- Reworked the node-page routing entry into one clear website-or-application rule editor.
- Kept website routing as the default, while adding process-name and full Windows executable-path choices for application routing.
- Added local validation, duplicate/conflict feedback, mode-specific labels and examples before the existing background atomic rule transaction runs.
- Kept the safety boundary: creating a rule does not switch the current node or alter the current connection.
- Preserves the 3.5.97 node-and-rule linkage acceptance path: `npm run audit:stage3-node-rule-link`.

## Verification

- All 164 Rust tests, node-to-rule, routing-product, backend, security, copy/encoding, UI, interaction, product, and soak gates passed.
- The existing three-run headless performance baseline remains non-deterministic on this host (the same 3.6.41 baseline also fails); thresholds were not relaxed and no product regression was observed in the passing UI, interaction, product, or soak checks.
- Silent local installation succeeded without changing FlClash or the Windows proxy (`127.0.0.1:7890`).

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.44_x64-setup.exe`
- Size: 16,168,640 bytes
- SHA-256: `0376CE2AF525D3D1BFA22953473FC992483ACC67526F8A79CCA83DC9B31F5B30`
