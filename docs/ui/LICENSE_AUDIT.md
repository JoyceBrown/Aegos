# UI Dependency and License Audit

## Current release

No new UI dependency is required for the adopted first phase. Existing SVG-mask icons are maintained in project CSS and no third-party UI source is copied.

## Candidate policy

- Tauri: existing MIT/Apache-2.0 foundation.
- TanStack Table/Virtual: MIT; add only after a fixture proves current rendering misses its performance or interaction target.
- ECharts: Apache-2.0; add only with a real traffic-history data contract and lazy loading.
- Lucide: verify the package license and attribution before use; prefer the current internal registry while it remains sufficient.
- Motion: MIT; do not add while CSS covers the small approved motion set.
- Monaco: MIT; lazy-load only for an approved advanced editor.
- Playwright: Apache-2.0; may replace current CDP screenshot plumbing after a migration RFC.
- Storybook: MIT; defer until component extraction creates a real isolated-component surface.
- Clash Verge Rev: GPL-3.0 reference only. Do not copy source, styles, icons, or recognizable page implementations.

Every added package must record pinned version, license, purpose, bundle impact, maintenance state, and removal plan.
