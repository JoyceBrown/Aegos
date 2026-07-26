# Aegos 3.6.60

## Scope

- Productize the existing Additional Rules and protected YAML override surfaces
  as one safe configuration-extension workspace.
- Add line-aware validation, an Aegos-intent diff, explicit preflight, and
  restore-to-last-successful behavior without exposing runtime YAML or the
  Mihomo controller.
- Preserve the verified 3.6.59 DNS, node-selection, measurement-only speed,
  rollback, responsiveness, and background-worker behavior.

## Changes

- Added an asynchronous `config_extensions_preview` command. It snapshots only
  persisted Aegos settings, performs bounded parsing on a worker, and reuses the
  same rule/YAML validators used by runtime compilation.
- Validation issues now carry a safe surface, error code, line, and column.
  Draft content and protected values are not returned to the page.
- Added an intent-level diff that reports rule counts, additions/removals,
  enable-state changes, and whether protected YAML intent changed. It never
  returns generated runtime YAML.
- Split preview from apply. Apply remains disabled until the current draft has
  passed preflight, and any subsequent edit invalidates the preview.
- Added request sequencing so a slow preview cannot overwrite a newer draft.
  Settings navigation remains available while preview work is running.
- Added explicit restore to the latest successfully applied Aegos extension
  intent. Restore edits the draft only; all changed drafts still use the single
  existing `updateSettings` transaction for preflight, runtime verification,
  persistence, and rollback.
- Added Rust, interaction, configuration-extension audit, minimum-window, rapid
  navigation, stale-result, and soak coverage for the new workflow.

## Verification

- 199 Rust unit tests passed.
- `npm run smoke:interactions` passed all 10 user journeys, including invalid
  line-level preview, valid intent diff, stale-preview rejection,
  navigation-during-preview, transactional apply, and restore.
- `npm run smoke:ui` passed all 14 viewport/DPI combinations, including the
  920x640 minimum window.
- `npm run smoke:perf:stress` passed 420 rapid navigation changes and the
  existing 800-node/background-work pressure scenarios.
- `npm run smoke:soak` passed 16 concurrent journey cycles with
  `stuckTesting=false` and stable listener counts.
- Configuration-extension, backend, responsiveness, stability, security,
  control-plane, architecture, installer, and final release audits passed.
- The control-plane budget passed with `main=11747/11770 production lines` and
  `core_runtime=2893/2900 production lines`.
- `git diff --check` passed.
- FlClash remained running as PID 5024 and was not stopped, restarted,
  modified, or taken over.

## Artifact

- Installer: `src-tauri/target/release/bundle/nsis/Aegos_3.6.60_x64-setup.exe`
- Size: `16273408` bytes
- SHA-256:
  `cf9708a66ce921a6f8077a93ba84e54e228ba5aad4cdfb089f007efd58b72e0f`
- Signature: unsigned open-source build

## Known Limits

- The workspace edits Aegos extension intent, not complete subscription or
  runtime YAML. Aegos-owned controller, DNS, TUN, rule-fallback, port, secret,
  and other protected fields remain unavailable here.
- Restore returns to the latest successfully applied extension intent. It is
  not a general configuration-history or cloud-backup system.
- Real airport connectivity is not simulated by deterministic fixtures;
  existing user validation remains the real-network acceptance source.
- The installer is not Authenticode-signed, so Windows may show a reputation
  warning until a trusted signing certificate is configured.
- Automatic updates, signed rollback, backup synchronization, Windows ARM64,
  and other platforms remain outside this release.
