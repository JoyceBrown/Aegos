# Aegos Design Tokens

The authoritative implementation is the Stage 7 `:root` block in `src/styles.css`.

## Roles

- Surface: canvas, panel, strong panel, control, hover, and pressed.
- Text: primary, secondary, tertiary, and on-accent.
- Border: subtle, control, and active.
- Status: success, warning, danger, and information, each with a soft companion.
- Motion: 120ms fast, 180ms normal, 240ms slow, standard easing.
- Focus: two-pixel visible focus ring with two-pixel offset.
- Geometry: shell, sidebar, titlebar, page top, home hero, quick actions, and fixed icon/control dimensions.

## Rules

- New visual values must use a semantic token or extend the authoritative root with a documented role.
- Ordinary panels and table rows do not receive decorative elevation.
- Blur is reserved for a modal backdrop only when it does not harm Windows performance.
- Hover movement is at most one pixel; pressed controls do not scale.
- Text size never changes between default, hover, pressed, pending, or selected states.
