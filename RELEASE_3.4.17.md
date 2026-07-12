# Aegos 3.4.17

## Scope

3.4.17 productizes diagnostics and logs:

- Diagnostics can be exported as a redacted text report.
- Diagnostic export runs through the background job model.
- The diagnostics page keeps copy, export, and run actions separate.
- Log export now includes a redaction notice and category summary.
- Exported log lines are sanitized again at export time.

## User Value

用户遇到问题时，可以运行诊断、复制报告、导出诊断报告、导出日志。导出的内容会说明已经做脱敏处理，方便发给开发者排查。

## Safety

- Export paths are confined to app data diagnostics folder.
- Diagnostic report and logs are written through atomic replacement.
- Tokens, subscription URLs, UUIDs, passwords, local paths, and sensitive IP-like details are masked where possible.

## Verification

- `npm run check`
- `npm run audit:diagnostics-product`
- `npm run audit:diagnostics`
- `npm run audit:responsiveness`
- `npm run audit:stability`
- `npm run audit:release`

## Artifact

Source-only checkpoint. No installer is produced for 3.4.17.

SHA-256: source-only
