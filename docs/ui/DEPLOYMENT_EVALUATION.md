# Aegos UI/UX Proposal Deployment Evaluation

## Decision

The proposal's product direction is accepted: Aegos should feel like a calm, trustworthy network control product whose UI renders Aegos runtime truth, recovery, and diagnostics rather than exposing Mihomo concepts.

The proposed React-only implementation choice is not accepted for the current codebase. Aegos 3.6.30 uses a Tauri shell with native HTML, CSS, and JavaScript. Its tested DOM helpers, background task model, state snapshot rendering, and command mocks already cover the critical user paths. Migrating to React, MUI, or shadcn now would create a second UI path and duplicate state during the highest-risk part of development.

## Adopt now

- Semantic design tokens, restrained motion, visible focus, reduced-motion support, and fixed viewport/DPI screenshots.
- Calm surfaces with fewer shadows and less blur.
- A status center for system takeover detail, background tasks, and recovery evidence.
- One ordinary-user navigation model. Logs remain inside Diagnostics instead of returning as a duplicate top-level page.
- Structured loading, empty, error, pending, rollback, and recovery states.
- A behavior-freeze gate that prevents visual work from changing Tauri command behavior.
- License and supply-chain gates before adding any UI dependency.

## Adapt to Aegos

- Keep the current native UI stack and extract reusable boundaries incrementally.
- Treat the existing `invoke()` wrapper as transitional debt. Move commands behind typed service functions by feature, with command-trace comparison after each batch.
- Keep the current window minimum of `1180x700`; add `1180x720` and `1440x900` evidence without changing the supported minimum unexpectedly.
- Keep Diagnostics and Logs merged. Runtime logs are evidence inside the repair workflow.
- Keep the current lightweight SVG-mask icon registry. A Lucide package is unnecessary while the existing registry covers the product without runtime cost.
- Use existing CDP smoke infrastructure as the visual/E2E foundation. Adding Playwright is deferred until it replaces, rather than duplicates, that coverage.

## Defer until a measured need exists

- React, MUI, shadcn, Tailwind, or another full UI framework.
- ECharts until a real traffic-history data contract exists.
- Monaco until an approved advanced editor is part of the ordinary-user rule workflow.
- TanStack Virtual until the current windowed node renderer or bounded log renderer fails the target fixture.
- Storybook until reusable components are split from `app.js`; isolated browser fixtures remain the near-term component-state tool.
- Dark mode until the light theme and all state semantics pass product acceptance.

## Deployment order

1. Freeze the 3.6.30 command surface and document the current stack, state flow, duplication, tokens, and licenses.
2. Reduce App Shell noise by moving detailed network state and background jobs to a status center.
3. Flatten the visual surface system without changing page DOM or network actions.
4. Extract typed Tauri services and feature render modules in small command-trace-preserving batches.
5. Strengthen page fixtures for loading, empty, error, rollback, large lists, and sensitive data.
6. Reassess headless table/virtualization/chart/editor dependencies against measured failures only.

## Acceptance

No phase is accepted from a document or static string check alone. It must pass command-surface freeze, interaction smoke, 420-switch performance smoke, soak smoke, fixed viewport/DPI layout smoke, Rust tests, security/redaction audits, and screenshot review.
