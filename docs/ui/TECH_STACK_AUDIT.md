# UI Technical Stack Audit

## Current stack

- Desktop shell: Tauri 2, configured in `src-tauri/tauri.conf.json`.
- Frontend: native HTML in `src/index.html`, native JavaScript in `src/app.js`, and global CSS in `src/styles.css`.
- UI frameworks: none.
- Runtime dependencies: no frontend framework, icon package, chart library, table library, or animation library.
- Build: Tauri serves `src` directly; there is no Vite/Webpack application bundle.

## Current strengths

- `el()`, `text()`, and `replaceChildrenSafe()` render dynamic data through safe DOM APIs.
- A shared `uiStore` controls navigation and local filters.
- Runtime state is rendered from `app_status`; long operations use the background-job contract.
- Node rendering is bounded and cached, and large-list work is deferred.
- Browser smoke tools mock Tauri at the command boundary and exercise the full ordinary-user path.

## Current debt

- `src/app.js` is a 6,000+ line mixed feature module.
- Tauri calls use one wrapper but remain scattered through page and feature functions.
- `src/styles.css` contains historical component definitions followed by later canonical overrides.
- Reusable Button/Input/Dialog/Table contracts are represented by selectors rather than explicit modules.
- CSS still contains hundreds of direct color declarations and many legacy shadows.

## Stack decision

Continue with native HTML/CSS/JS for this product line. Refactor by boundary, not by framework migration. A framework proposal requires a separate RFC proving state migration, bundle impact, command-trace parity, rollback, and performance under Aegos fixtures.
