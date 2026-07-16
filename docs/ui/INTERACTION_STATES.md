# Aegos Interaction States

## Controls

Buttons support default, hover, pressed, focus-visible, pending, disabled, and danger. Inputs support empty, filled, focus, disabled, read-only, invalid, and valid. Rows support default, hover, selected, current, pending, error, and unavailable.

## Network operations

- Connection: disconnected -> preparing -> starting -> applying takeover -> verifying -> connected, with explicit error and recovery outcomes.
- Node switch: idle -> switching -> verifying -> success, or rollback -> restored/rollback failed.
- Configuration deployment: draft -> validating -> compiling -> prechecking -> applying -> verifying -> committed, or rolling back -> restored/failed.
- Speed test: queued -> testing per node -> partial results -> complete/cancelled. It never selects or connects a node.

## Concurrency

Mutating operations may exclude conflicting mutating operations, but browsing, page switching, diagnostics evidence, and the status center remain usable. Pending feedback stays local to the initiating button, row, or background task.
