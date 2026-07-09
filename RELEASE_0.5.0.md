# Aegos 0.5.0

## 更新重点
- 移除侧栏重复的 profile/版本卡片，版本号回到顶部 Aegos 标志旁。
- 首页连接区新增 TUN 开关，并与设置页共用 `tunEnabled` 状态。
- 按 Aegis 2.0 的密度逻辑恢复首页：连接区固定尺寸，推荐/常用地区/快捷操作为三行，常用节点改回表格行。
- 修复窗口横向拉伸时字体、图标、连接圆环跟随拉伸的问题；宽度变化只调整列宽和可用空间。
- 修复最小高度下侧栏网络状态换行风险，网络状态区始终单行省略。
- 安装器跳过 WebView2 在线引导下载，减少安装阶段因网络或引导器失败产生的报错。

## 验证
- `node --check src/app.js`
- `node --check tools/release-audit.js`
- `node --check tools/ui-smoke.js`
- `npm run smoke:ui`
- `npm run check`
- `npm run build`
- `npm run audit:release`
- NSIS 静默安装测试通过。
- release exe 与安装后 exe 均通过启动存活测试。
