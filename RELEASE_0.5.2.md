# Aegos 0.5.2

## 更新重点
- 窗口移动、最小化、最大化、关闭改为 Rust 窗口命令兜底，不再依赖前端 window API。
- 订阅导入支持 Clash YAML、ss/vmess/trojan URI 列表和 base64 URI 订阅。
- 导入只有 `proxies` 的订阅时自动生成 `GLOBAL` 选择组和默认规则，导入后立即刷新节点预览。
- 核心未运行时也能从当前订阅读取节点列表，避免“导入后获取不到节点”。
- 当前协议显示改为节点协议，如 SS、Trojan、SSR、VMess、VLESS 等，不再显示 mihomo 内核名。
- 网络状态栏在系统代理未开启时隐藏系统代理行。
- 快捷操作改为更贴近日常代理客户端的直达动作：一键测速、更新订阅、系统代理、刷新落地 IP、切换模式、TUN、复制代理、重启内核。
- 一键测速留在首页执行，不再跳转诊断页。
- 代理端口指标列调整为中等宽度，避免过宽也避免隐藏端口文本。

## 验证
- `node --check src/app.js`
- `npm run smoke:ui`
- `npm run check`
- `npm run build`
- `npm run audit:release`
