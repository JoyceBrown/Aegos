# Aegos 3.4.16

## Scope

3.4.16 productizes the routing page from draft preview into a guarded user workflow:

- Create website, app, region, or connection-based routing drafts.
- Verify drafts before applying them.
- Apply drafts through a background job, not a foreground UI lock.
- Preflight generated config before writing.
- Write profile config with confined atomic replacement.
- Hot reload the active profile when the core is running.
- Roll back automatically if hot reload fails.
- Undo the most recent routing apply from an app-data backup.

## User Value

普通用户现在可以完成一条完整分流任务：生成草稿、看懂风险、验证、应用、撤销。页面不再只是调试式只读快照。

## Safety

- Routing writes only accept structured Aegos drafts.
- No arbitrary YAML editor is exposed.
- Targets must already exist in the active profile.
- Backup files are confined to app data.
- User input is rendered through DOM/text APIs, not dangerous HTML insertion.

## Verification

- `npm run check`
- `npm run audit:routing-product`
- `npm run audit:product-maturity`
- `npm run audit:responsiveness`
- `npm run audit:stability`
- `npm run audit:release`

## Artifact

Source-only checkpoint. No installer is produced for 3.4.16.

SHA-256: source-only
