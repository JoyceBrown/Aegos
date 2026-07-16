# Aegos Stage 7 Visual System

## Scope

Stage 7 changes presentation, accessibility, responsive behavior, and release verification only. It must not alter connection, speed-test, subscription, routing, diagnostics, or Windows takeover command behavior.

## Semantic tokens

- Surfaces: `--surface-canvas`, `--surface-panel`, `--surface-panel-strong`, `--surface-control`, `--surface-control-hover`.
- Text: `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-on-accent`.
- Borders: `--border-subtle`, `--border-control`, `--border-active`.
- Status: `--status-success`, `--status-warning`, `--status-danger`, `--status-info` and their soft backgrounds.
- Focus: `--focus-ring` with a visible two-pixel outline and two-pixel offset.
- Motion: `--motion-fast`, `--motion-normal`, `--motion-slow`, and `--ease-standard`.
- Geometry: one authoritative root owns shell, titlebar, home hero, quick action, and ring dimensions.

## Component states

Every interactive control must expose stable default, hover, active, focus-visible, pending, and disabled states without changing text size or control dimensions. Pending state is local to the control or row and must never lock global navigation.

Icon-only controls require a Chinese `aria-label` and matching `title`. Icons use the centralized SVG-mask registry; text glyphs are not used as interface icons.

## Motion contract

- Hover translation is at most one CSS pixel.
- Pressed controls return to their original position; no scale animation is allowed.
- Page and dialog motion is short and opacity/transform-only.
- `prefers-reduced-motion: reduce` disables nonessential animation and transition.

## Responsive and DPI matrix

Required CSS viewports: `1180x700`, `1280x700`, `1280x820`, `1280x1080`, and `1700x900`.

Required Windows scale equivalents: 100%, 125%, 150%, 175%, and 200% through device-scale smoke coverage. Text, icons, navigation, the home hero, quick actions, tables, dialogs, and scroll containers must remain visible and stable.

## Behavior freeze

`STAGE7_BEHAVIOR_BASELINE.json` records the literal Tauri command call surface at 3.6.24. `tools/stage7-visual-audit.js` rejects command additions, removals, or count changes. Existing interaction, performance, soak, Stage 1-6, security, and release gates remain mandatory.

## Acceptance

Stage 7 is complete only when static visual checks, browser screenshots, DPI coverage, keyboard focus checks, interaction smoke, performance smoke, soak smoke, Rust tests, installer build, installer hash, and final release audit all pass.
