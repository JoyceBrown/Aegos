# Aegos 2.3.3

## Highlights

- Source-only checkpoint.
- Added a shared operation queue for core-changing actions.
- Serialized core power, profile switch, profile removal, settings apply, mode switch, proxy switch, and recovery operations.
- Kept subscription download outside the queue, so slow network fetches do not block unrelated UI state.

## Verification

- Covered by the final Aegos 2.4.0 verification gate.

## Artifact

- Source-only.
- SHA-256: Source-only.
