# Aegos 3.1.0

Source checkpoint for the read-only routing page skeleton.

## Changes
- Added a read-only "分流" page entry and panel.
- Added backend `routing_snapshot` as a safe read-only summary of mode, strategy
  groups, and recent rule hits.
- Added `audit:routing-readonly` to prevent rule editing or config writes from
  entering the 3.1 read-only lane.
- Updated architecture and release gates so routing is allowed only when the
  read-only guard is present.
- Bumped package, Tauri, Cargo, and sidebar versions to 3.1.0.

## Verification
- `npm run audit:routing-readonly`
- `npm run audit:architecture`
- `npm run audit:release`
- `npm run audit:security`
- `npm run audit:debt`
- `npm run audit:speed`
- `npm run smoke:interactions`
- `npm run smoke:perf`
- `npm run smoke:soak`
- `npm run check`
- `git diff --check`

## Artifact
- Source checkpoint: no installer built for this checkpoint.
- SHA-256: Source-only
