# UI Dependency and License Audit

## Current release

The icon and typography polish uses a pinned subset of Microsoft Fluent UI System Icons:

- Repository: `microsoft/fluentui-system-icons`
- Commit: `9a1129bb2432b163b48044341664c68a3c100908`
- License: MIT
- Scope: 38 archived 20 px UI SVG files, one 48 px shield source for the Aegos brand composition, and the upstream license in `third_party/fluent-ui-system-icons`
- Runtime impact: SVG source is embedded into CSS masks; no package, script, file request, network request, icon font, or dynamic loader
- Bundle impact: the archived source SVGs live outside `src`; only their CSS-embedded copies enter the frontend bundle
- Removal plan: restore the project-owned CSS mask registry and delete `third_party/fluent-ui-system-icons`

The Aegos brand composition, A-shaped route glyph, and color treatment are project-owned. Its shield silhouette derives from Fluent `Shield 48 Filled` at the same pinned commit under MIT. Typography uses Windows system fonts only, so no font license or binary payload is added.

## Candidate policy

- Tauri: existing MIT/Apache-2.0 foundation.
- TanStack Table/Virtual: MIT; add only after a fixture proves current rendering misses its performance or interaction target.
- ECharts: Apache-2.0; add only with a real traffic-history data contract and lazy loading.
- Fluent UI System Icons: approved only as the pinned, locally licensed subset above.
- Lucide: ISC; retain as a fallback candidate if Fluent lacks a future semantic icon.
- Motion: MIT; do not add while CSS covers the small approved motion set.
- Monaco: MIT; lazy-load only for an approved advanced editor.
- Playwright: Apache-2.0; may replace current CDP screenshot plumbing after a migration RFC.
- Storybook: MIT; defer until component extraction creates a real isolated-component surface.
- Clash Verge Rev: GPL-3.0 reference only. Do not copy source, styles, icons, or recognizable page implementations.

Every added package must record pinned version, license, purpose, bundle impact, maintenance state, and removal plan.
