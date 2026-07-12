# Aegos 2.9.58 Copy And Encoding Debt

This checkpoint freezes copy/encoding debt as an auditable product surface.
It does not rewrite the UI in bulk because the current 2.7.x visual baseline is
stable and broad copy replacement can easily create layout regressions.

## Scope

- Production frontend text in `src/index.html` and `src/app.js`.
- User-visible error, diagnostic, subscription, node, and network labels.
- Frontend render safety for dynamic text.
- Documentation debt created by older PowerShell/terminal encoding output.

## Current Findings

- Current production suspicious line count: 0
- `src/index.html` and `src/app.js` read cleanly as UTF-8 through Node.
- PowerShell may still display Chinese text as mojibake in terminal output; that
  is a console rendering issue, not proof that production files are corrupted.
- `src/app.js` must keep all dynamic user/core text on text nodes or
  `textContent`.
- Some older research/release documents may have been viewed or copied through a
  garbled console path. They are not runtime-blocking, but they should be
  re-authored when the related plan is next touched.

## Freeze Rule

- No new mojibake-looking UI text may be introduced without updating this debt
  ledger and explaining why it was not fixed immediately.
- New user-visible copy should be short, plain Chinese, and understandable to a
  non-technical proxy user.
- Runtime user data, subscription names, node names, logs, and diagnostics must
  be rendered with `textContent`/text nodes, never HTML string injection.
- Test-only HTML fixtures must stay in `tools/` and must never be copied into
  production UI code.

## Cleanup Route

1. Re-author `src/index.html` static labels in small batches, one page at a time.
2. After every page batch, run UI smoke, interaction smoke, release audit, and a
   manual visual check at minimum, normal, and tall window heights.
3. Replace technical labels with plain user-facing Chinese only when the meaning
   is already stable.
4. Re-author garbled planning docs only when they are actively used for the next
   milestone, so old research churn does not distract from runtime stability.

## Acceptance

- `npm run audit:copy` passes.
- `npm run audit:release` includes the copy/encoding gate.
- Production frontend keeps dangerous HTML APIs banned.
- Suspicious line count is deliberately tracked instead of silently growing.
