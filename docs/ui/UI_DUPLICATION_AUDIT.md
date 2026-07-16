# UI Duplication Audit

## Confirmed duplication

- Button state and dimensions are repeated across primary, ghost, compact, tabs, quick actions, row actions, dialogs, and window controls.
- Input/select rules appear in forms, settings, routing assistants, dialogs, and node editors.
- Row surfaces are shared conceptually but implemented by home, node, connection, routing, profile, diagnostic, log, environment, and job selectors.
- Overlay/dialog geometry is repeated by app dialogs, node editor, member editor, target editor, and context menus.
- Historical CSS definitions remain before the authoritative Stage 7 overrides.

## Consolidation order

1. Tokens and control states.
2. App Shell and status center.
3. Form-field contract.
4. Row/table contract without changing feature columns.
5. Overlay/dialog contract.
6. Feature module extraction and deletion of superseded selectors.

Consolidation must reduce active ownership, not add another override block.
