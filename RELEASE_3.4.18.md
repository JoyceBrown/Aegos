# Aegos 3.4.18

## Scope

3.4.18 productizes settings, safety, and install readiness:

- Added an install and security readiness check on the settings page.
- Checks cover WebView2, administrator permission, mixed/controller ports, controller bind exposure, allow-lan, bundled core resource, and system proxy restore snapshot.
- Port checks show occupied-process detail instead of vague failure.
- Readiness refresh is detached and does not block navigation.
- Long paths and process details are bounded in the settings layout.

## User Value

普通用户不需要猜“为什么不能用”。设置页会直接告诉用户当前电脑是否缺权限、端口是否被占用、是否暴露到局域网、安装依赖是否由安装包处理。

## Safety

- The readiness check is read-only.
- It does not auto-change ports, proxy, firewall, or LAN exposure.
- Controller and LAN exposure remain local/closed by default unless the user explicitly changes settings.

## Verification

- `npm run check`
- `npm run audit:settings-security-product`
- `npm run audit:security`
- `npm run audit:installer-regression`
- `npm run audit:responsiveness`
- `npm run audit:release`

## Artifact

Source-only checkpoint. No installer is produced for 3.4.18.

SHA-256: source-only
