# Aegos 开源参考研究与吸收任务表

更新时间：2026-07-12

当前 Aegos 基准：2.9.52

来源核验日期：2026-07-12

目标：把外部成熟代理客户端和核心项目的“可验证策略”吸收到 Aegos，而不是盲目照搬代码。优先服务当前主线：基础稳定、测速可信、连接闭环、订阅兼容、安全收口、再进入策略组/分流与跨平台。

执行标准：所有参考项目进入开发前，必须先通过 `research/opensource-absorption-standard.md` 中的来源核验、对比、评估、结构拆解、融合路线和验收门禁。

证据边界：

- 本文只把公开 README、官方文档、API 文档、项目描述和维护状态作为参考依据。
- 对 GPL-3.0 等强 copyleft 项目，只吸收产品策略、架构边界、测试方法和公开 API 语义，不直接复制代码、图标、样式、文案或资源。
- 对维护活跃度、stars、release 等数据，只作为 2026-07-12 的快照，不作为长期结论。
- 真正进入 Aegos 前，必须补对应的 fixture、audit、smoke 或人工回归清单，不能因为某个开源项目“看起来成熟”就直接接入。

当前核验到的公开信息：

- FlClash README 定位为基于 ClashMeta 的多平台代理客户端，强调 simple、open-source、ad-free；项目许可证为 GPL-3.0。
- Clash Verge Rev README/组织页定位为基于 Tauri、面向 Windows/macOS/Linux 的现代 GUI；适合参考桌面工程和跨平台边界，但同样不能直接搬代码。
- v2rayN 项目定位为 Windows/Linux/macOS GUI，支持 Xray、sing-box 等核心；适合参考协议兼容和迁移能力。
- Hiddify App 定位为多平台代理客户端，支持 sing-box、Xray、TUIC、Hysteria、Reality、Trojan、SSH 等；适合参考普通用户低门槛产品逻辑。
- mihomo API 文档明确 `/group/{name}/delay` 会测试组内节点并清除自动策略组固定选择，因此 Aegos 必须把“测速不改变用户当前选择”的封装边界写死。
- MetaCubeXD 明确具备实时流量、代理组延迟测试、连接追踪、规则查看、实时日志等 dashboard 能力，适合作为 Aegos 高级页的信息组织参考。
- sing-box 官方定位是 universal proxy platform，适合作为未来 CoreAdapter 和 IPv6/TUN/路由模型参考，不适合 3.0 前仓促接入运行核心。
- jinqians/snell.sh 是 Snell/ShadowTLS Linux 服务端部署脚本，只适合提炼节点模板、参数校验和服务端说明生成思路，不适合在 Aegos 客户端默认执行远程 shell。

## 0. 当前版本判断

Aegos 2.9.52 已具备：

- Tauri + Rust + 原生 HTML/CSS/JS 桌面壳。
- mihomo 单核心运行链路。
- 后台 job 模型：连接、订阅、设置、诊断、落地 IP 等长任务不应阻塞 UI。
- 测速后台化、单节点测速、批量测速、失败原因显示、低延迟阈值。
- 订阅导入、更新、切换回滚、部分现代协议 URI 支持。
- Windows 系统代理、TUN、断网保护、端口避让、日志脱敏、安装包审计。
- 大列表渲染、懒索引、导航/诊断/测速稳定性 smoke。

仍然不足：

- 策略组/分流规则还没有用户可理解的正式页面。
- 规则编辑、安全预检、热重载、回滚还没有产品化。
- IPv6 自动检测、防泄漏、防回退策略还没有做。
- 多核心能力没有做，当前仍主要围绕 mihomo。
- 与 FlClash 等成熟客户端相比，真实机场大样本测速成功率和速度仍需持续实测对标。
- 用户级“为什么失败、下一步怎么办”的诊断还需要进一步结构化。
- macOS/Linux 适配、签名、权限、系统代理接管还未进入正式阶段。

## 1. 参考项目优先级总表

| 优先级 | 项目 | Aegos 应吸收什么 | 当前是否适合做 | 主要风险 |
|---|---|---|---|---|
| P0 | MetaCubeX/mihomo + 官方 API 文档 | 测速、策略组、规则、连接、流量、provider healthcheck 的官方语义 | 立即 | 误用 API 会导致测速自动切换或污染策略组 |
| P0 | FlClash | 快速响应、测速不卡 UI、普通用户友好的交互节奏 | 立即吸收策略 | GPL 项目，不能直接复制实现和视觉资产 |
| P0 | Clash Verge Rev | Tauri/Rust 桌面工程、系统代理、跨平台发布、安全权限边界 | 立即吸收架构思想 | GPL 项目，直接复制代码有许可证风险 |
| P1 | MetaCubeXD | mihomo dashboard 的信息组织、控制面安全、规则/连接/日志可视化 | 3.0 后 | 不要把 Aegos 做成复杂 dashboard |
| P1 | v2rayN | 多核心、多协议、订阅兼容、用户迁移能力 | 3.1 起 | 多核心过早会冲散当前稳定主线 |
| P1 | Hiddify App | 自动节点选择、TUN、远程配置、普通用户低门槛 | 3.1 起 | Flutter/Dart 思路不能直接照搬到 Tauri |
| P2 | sing-box | 未来第二核心、IPv6/TUN/路由能力、多协议统一模型 | 3.2 起 | 双核心配置抽象难度高 |
| P2 | NekoBox/NekoRay | 插件化协议、便携包、sing-box 配置管理 | 3.2 起 | NekoRay 已停止维护，适合参考模型不适合依赖 |
| P2 | NekoBox for Android | 协议覆盖清单、插件支持边界、移动端思路 | 3.2 起 | Android 平台特性与 Windows/Tauri 差异大 |
| P3 | jinqians/snell.sh | 服务端部署向导、Snell/ShadowTLS 参数校验、节点模板 | 3.3 起 | 这是服务端脚本，不是客户端核心能力 |
| P3 | clash-nyanpasu | Tauri Clash GUI 的另一套交互/配置经验 | 3.3 起 | 需要单独代码级研究，不能只看 README |

## 2. 项目级详细评估

### 2.1 MetaCubeX/mihomo 与官方 API

定位：Aegos 当前核心是 mihomo，所以最优先的不是追更多客户端，而是吃透核心 API 的真实语义。

可吸收内容：

- `/group`、`/group/{name}`：用于策略组页，不要继续把策略组引用伪装成普通节点。
- `/group/{name}/delay`：批量测策略组内节点，但要注意官方语义会“清除自动策略组固定选择”，Aegos UI 必须避免让用户误以为测速会连接。
- `/proxies/{name}/delay`：单节点测速，适合节点行按钮。
- `/providers/proxies/{provider}/healthcheck`：订阅 provider 层健康检查，适合未来“订阅测速/机场健康”。
- `/rules`、`/providers/rules`：分流页基础数据。
- `/connections` 和 `/traffic`：连接页、实时流量、活跃连接指标。
- `external-controller` 和 `secret`：必须继续保持本地绑定和密钥。

Aegos 当前已有：

- controller 本地端口和 secret。
- speed path、单节点测速、provider/规则部分尚未产品化。
- 策略组引用已从普通节点列表隐藏。

任务：

- [P0] 建立 `core-api-contract.md`，把 Aegos 使用的 mihomo API、是否可能改变选择、是否可能阻塞、超时标准写清楚。
- [P0] 把批量测速统一标注为 measurement-only，禁止 UI 或后端连带 changeProxy。
- [P0] 为 `/group/{name}/delay` 做安全封装：如果 group 是 url-test/fallback/load-balance，UI 显示自动策略组提示。
- [P1] 使用 `/providers/proxies` 区分订阅节点、手动节点、策略组引用、metadata。
- [P1] 连接页补齐 `/connections` 关闭连接、按规则/节点过滤。
- [P1] 分流页读取 `/rules`，但先只展示，后续再编辑。

验收：

- 测速永不改变当前节点。
- 策略组、节点、provider、规则在数据结构上分层清晰。
- 所有 API 调用有超时、取消、日志脱敏、错误分类。

### 2.2 FlClash

定位：最值得 Aegos 学的是“体感流畅”和普通用户视角。它是基于 ClashMeta 的多平台客户端，README 明确定位为 multi-platform、simple、open-source、ad-free。

可吸收内容：

- 点击先反馈，数据后更新。
- 测速过程中页面仍可操作。
- 节点、订阅、模式切换的视觉反馈不要等待后端完成。
- 普通用户优先，不把核心术语堆在首页。
- 桌面和移动端共通的简洁信息层级。

Aegos 当前已有：

- 乐观 UI。
- 后台 job。
- 诊断/测速不锁导航。
- 大列表懒索引和 windowed rendering。

差距：

- Aegos 的文案、日志、错误说明仍有历史编码和信息层级问题。
- 首页/节点页的信息密度仍需进一步打磨。
- 真实协议测速成功率与 FlClash 的差距还要用同一批节点反复测试。

任务：

- [P0] 建立 FlClash 对标清单：启动、切页、切订阅、测速、单节点测速、模式切换，每项记录 Aegos/FlClash 的耗时、成功率、是否卡 UI。
- [P0] 持续保留 `smoke:perf`、`smoke:soak`，并加入“测速中快速切 7 页”的专项。
- [P1] 做首页信息层级二次清理：只留当前节点、系统代理、落地 IP、实时流量、稳定性、关键快捷动作。
- [P1] 节点页增加“失败原因优先显示”，减少用户看到“未测速”的情况。
- [P2] 做一轮文案和编码清洗，中文显示必须统一。

验收：

- 快速切页 p95 < 4ms，不能有严重 long task。
- 测速中切页、切订阅、筛选节点不能残留“测速中”。
- 用户不需要理解策略组也能完成连接、测速、切换、诊断。

### 2.3 Clash Verge Rev

定位：Aegos 同为 Tauri/Rust 桌面应用，应重点参考其桌面工程化、系统代理、跨平台发布和安全边界。其组织页描述它是基于 Tauri、面向 Windows/macOS/Linux 的现代 GUI。

可吸收内容：

- Tauri 权限边界、系统代理抽象、跨平台包结构。
- profile/订阅/核心配置的分层。
- service mode、托盘、开机启动、代理修复等桌面应用工程经验。
- 可参考其系统代理相关 Rust crate 或思路，但要注意许可证和代码复用边界。

Aegos 当前已有：

- Windows 系统代理接管、恢复。
- installer candidate audit。
- Tauri ACL 和 CSP 审计。

差距：

- macOS/Linux 系统代理/TUN/权限没有实现。
- 托盘、后台驻留、自动启动仍未正式产品化。
- release channel、自动更新、签名还没有规划到实现层。

任务：

- [P1] 建立 `platform-abstraction.md`：Windows/macOS/Linux 的系统代理、TUN、权限、托盘、开机启动差异。
- [P1] 把 Windows 系统代理逻辑抽象成 `PlatformProxyManager`，当前只实现 Windows。
- [P2] 加托盘：连接/断开、当前节点、系统代理状态、退出时恢复。
- [P2] 做自动更新/版本通道评估，先只研究不实现。
- [P3] macOS/Linux 原型验证，不进入主线前不承诺安装包。

验收：

- Windows 能保持现有行为不退化。
- 平台相关代码不散落到 UI 和核心配置生成里。
- Tauri capabilities 不为方便而扩大权限。

### 2.4 MetaCubeXD

定位：官方 mihomo dashboard，价值在“控制面信息组织”和“直接面向 mihomo API 的 dashboard 模型”。

可吸收内容：

- dashboard 与核心 API 的关系：UI 指向 mihomo API，secret 控制访问。
- 规则、连接、日志、provider 的信息组织。
- 控制面 token/secret 的安全思路。

Aegos 当前已有：

- 自带 UI，不需要外部 dashboard。
- controller secret、本地绑定、日志导出。

任务：

- [P1] 诊断页增加“核心 API 可达性、secret、controller bind、provider 状态”的分层检查。
- [P1] 连接页学习 dashboard 的连接表：host、rule、chains、upload/download、close。
- [P2] 分流页第一版只读展示规则命中、规则集、目标策略组。

验收：

- Aegos 不变成复杂 dashboard，但高级用户能看清核心状态。
- secret 和 token 永远不进入普通日志。

### 2.5 v2rayN

定位：Windows 用户量大，强在多核心、多协议、订阅兼容和长期积累。README 明确支持 Windows/Linux/macOS，并支持 Xray、sing-box 等。

可吸收内容：

- 多核心资产管理：Xray、sing-box、其他核心。
- 协议兼容矩阵：VMess、VLESS、Trojan、SS、Socks、Reality、XTLS 等。
- 订阅格式兼容、导入失败诊断。
- 迁移导入：用户从 v2rayN 导出配置导入 Aegos。

Aegos 当前已有：

- mihomo 单核心。
- VLESS/Hysteria2/AnyTLS/TUIC 等 URI 部分支持。
- subscription diagnostics。

不建议现在做：

- 不建议 3.0 前引入 Xray/sing-box 多核心运行。当前地基仍要先稳。

任务：

- [P1] 建立协议能力矩阵：parser 支持、mihomo 支持、UI 手动添加支持、测速支持、诊断支持。
- [P1] 增加真实订阅 fixture：ss/trojan/vless/tuic/anytls/hy2 混合源。
- [P2] 设计多核心抽象，但先不接第二核心。
- [P3] 做 v2rayN 配置导入研究。

验收：

- 用户导入失败能知道是下载失败、格式失败、协议不支持、核心不支持还是运行预检失败。
- 新协议进入前必须先有 fixture 和 audit。

### 2.6 Hiddify App

定位：面向普通用户的多平台自动代理客户端，基于 sing-box toolchain，强调自动节点选择、TUN、远程 profile。

可吸收内容：

- 自动节点选择的产品化表达。
- 普通用户不需要懂规则，也能选择“自动/地区/用途”。
- 远程配置/profile 的低门槛管理。
- TUN 和规则模式对普通用户的解释。

Aegos 当前已有：

- 常用地区、常用节点、固定节点、收藏节点。
- 自动策略组提示，但还没有完整策略组页。

任务：

- [P1] 首页保留简单模式：“智能分流 / 全局 / 直连”，高级策略隐藏到分流页。
- [P1] 策略页提供向导式规则：应用、网站、地区、关键词，不要求用户写 YAML。
- [P2] 自动节点选择改为“用户可理解的策略”：最快、稳定优先、同地区优先、流媒体优先。
- [P2] TUN/系统代理/断网保护写成用户语言和诊断建议。

验收：

- 普通用户无需写规则也能完成自定义分流。
- 高级设置不污染首页。

### 2.7 sing-box

定位：通用代理平台，未来可以成为第二核心或部分能力参考。官方定位为 universal proxy platform。

可吸收内容：

- 多入站/出站/路由统一模型。
- TUN、WireGuard、规则、IPv6、DNS、防泄漏策略。
- 未来处理一些 mihomo 不适合覆盖的协议或平台能力。

Aegos 当前不应立即做：

- 不应在 3.0 前同时引入 sing-box 运行核心，否则会把配置生成、测速、系统接管、诊断全部复杂化。

任务：

- [P2] 做 `CoreAdapter` 设计文档：mihomo adapter 现状、sing-box adapter 未来接口。
- [P2] IPv6 自动检测方案以核心无关模型设计：本机 IPv6、节点 IPv6、IPv6 出口、泄漏检查。
- [P3] sing-box 实验分支，不进入主安装包。

验收：

- Aegos UI 不暴露“核心差异”，只暴露用户能理解的能力。
- 多核心不能破坏当前 mihomo 稳定链路。

### 2.8 NekoBox / NekoRay / NekoBox for Android

定位：NekoRay PC 已不再维护，但它和 NekoBox Android 的价值在协议覆盖、插件边界和 sing-box 配置管理经验。

可吸收内容：

- 插件化协议支持边界。
- 便携包/绿色版思路。
- 高级用户手动节点编辑体验。
- 移动端协议覆盖清单可作为 Aegos 协议路线参考。

任务：

- [P2] 手动节点编辑器补全字段：Reality、uTLS、SNI、ALPN、fingerprint、flow、obfs、shadow-tls、snell。
- [P2] 固定节点导入支持 URI、剪贴板、批量文本。
- [P3] 便携版可行性评估。

验收：

- 手动节点不是“摆设”，能导入、编辑、测试、连接、导出。
- 不能支持的字段要明确提示，而不是静默丢失。

### 2.9 jinqians/snell.sh

定位：这是 Snell/ShadowTLS Linux 服务端部署脚本，不是桌面代理客户端。它对 Aegos 的直接价值不是“拉入代码”，而是“服务端节点模板和参数校验思路”。

可吸收内容：

- Snell v4/v5/v6、ShadowTLS 的安装/版本/配置管理流程。
- 节点参数校验：PSK、server、port、obfs、shadow-tls、sni、wildcard-sni 等。
- 服务端部署向导或文档生成器。

不建议现在做：

- 不建议 3.0 前在 Aegos 内置 VPS 部署功能。
- 不建议直接执行远程 shell 脚本。安全风险高，用户信任成本高。

任务：

- [P3] 先做 Snell 节点手动导入/编辑/测速。
- [P3] 增加“服务端配置说明生成器”：根据用户输入生成 Snell/ShadowTLS 配置建议，但不自动 SSH 执行。
- [P4] 可选远程部署助手必须隔离权限、明确日志脱敏、不可默认执行 root 脚本。

验收：

- 用户能把现有 Snell 节点导入 Aegos。
- Aegos 不承担服务端运维风险，除非后续单独做安全设计。

## 3. 强烈建议拉入 Aegos 的优先级功能

### P0：2.9.53 - 3.0 前必须补强

- [ ] `core-api-contract.md`：定义 Aegos 使用 mihomo API 的稳定契约。
- [ ] 测速对标 FlClash：同订阅、同网络、同目标 URL、同 TUN 状态下记录成功率和耗时。
- [ ] 批量测速 / 单节点测速 / provider healthcheck 的边界说明和审计。
- [ ] 策略组引用继续隐藏在普通节点列表，但保留给未来策略页。
- [ ] 安装候选回归：安装、启动、连接、断开、切订阅、测速、诊断、日志导出、断网保护。
- [ ] 中文编码和文案缺陷清单：先记录，不在 3.0 前大改 UI。

### P1：3.0 - 3.2，成熟代理客户端基础能力

- [ ] 策略组/分流页第一版：只读展示策略组、规则、当前命中，不允许复杂编辑。
- [ ] 分流规则向导：网站、应用、地区、关键词、直连/代理/拒绝。
- [ ] 规则预检、生成、热重载、验证、回滚。
- [ ] provider 层健康检查和订阅健康页。
- [ ] 连接页增强：活动连接、规则、链路、关闭连接。
- [ ] 手动节点编辑器补全现代协议字段。
- [ ] 协议能力矩阵和订阅 fixture 扩展。

### P2：3.2 - 3.5，高级网络能力

- [ ] IPv6 自动模式：本机 IPv6、节点 IPv6、IPv6 出口、泄漏检测、自动回退 IPv4。
- [ ] CoreAdapter 设计：mihomo 当前实现，sing-box 未来实现。
- [ ] sing-box 实验核心，不进入默认安装包。
- [ ] macOS/Linux 系统代理和权限模型研究。
- [ ] 托盘、后台驻留、开机启动、退出恢复。

### P3：3.5 - 4.0，生态与迁移

- [ ] v2rayN 配置导入研究。
- [ ] NekoBox/NekoRay 手动节点字段映射。
- [ ] Snell/ShadowTLS 节点模板和配置说明生成器。
- [ ] 便携版/绿色版评估。
- [ ] 自动更新、签名、版本通道。

### P4：4.0 以后，不急

- [ ] 服务端部署助手。
- [ ] 多核心正式产品化。
- [ ] 移动端或 Flutter 版本。
- [ ] 高级规则市场/规则分享。

## 4. 许可证与安全边界

很多参考项目是 GPL-3.0。Aegos 可以学习产品策略、交互原则、架构分层和公开 API 用法，但不要直接复制 GPL 代码、图标、样式或资源，除非 Aegos 明确接受兼容的许可证策略。

必须遵守：

- 不直接拷贝 FlClash、Clash Verge Rev、v2rayN、NekoBox/NekoRay 的代码。
- 图标、视觉设计不能“高保真复刻”到侵权程度。
- 只引用官方文档/API 行为和公开 README 描述。
- 引入第三方依赖前必须记录 license、维护状态、更新频率、安全风险。
- 服务端脚本类项目不能在客户端里默认执行，尤其不能静默执行 root shell。

## 5. Aegos 近期任务表

| 版本 | 任务 | 参考来源 | 验收标准 |
|---|---|---|---|
| 2.9.53 | 建立 mihomo API 契约文档 | mihomo docs | 所有核心 API 调用有语义、超时、是否改状态说明 |
| 2.9.54 | FlClash 对标测速报告 | FlClash | 同订阅对比成功率、耗时、UI 卡顿，输出表格 |
| 2.9.55 | 测速目标 URL/expected 统一配置 | mihomo API | 批量/单节点/当前节点测速目标一致且可审计 |
| 2.9.56 | provider healthcheck 研究实现 | mihomo API | 订阅层健康检查不改变当前节点 |
| 2.9.57 | 安装包真实回归清单固化 | Clash Verge Rev 发布经验 | 安装、权限、端口、WebView2、恢复动作有 checklist |
| 2.9.58 | 中文文案/编码债务清单 | Aegos 本地 | 只建清单和风险等级，不大改 UI |
| 3.0.0 | 稳定候选 | 综合 | 主链路无阻塞、无自动连接误动作、安装包可测 |
| 3.1.0 | 策略组/分流只读页 | mihomo API / MetaCubeXD | 用户能看懂当前规则和策略组，不可编辑 |
| 3.2.0 | 分流规则向导 MVP | Hiddify / mihomo rules | 普通用户无需 YAML 添加规则 |
| 3.3.0 | 手动节点/协议字段补全 | v2rayN / NekoBox | 固定节点可导入、编辑、测速、连接 |
| 3.4.0 | IPv6 自动检测设计与实现 | sing-box/mihomo 思路 | 自动检测、防泄漏、回退提示 |
| 3.5.0 | CoreAdapter 实验 | sing-box / v2rayN | 不影响 mihomo 默认核心 |

## 6. 资料来源

- FlClash: https://github.com/chen08209/FlClash
- Clash Verge Rev: https://github.com/clash-verge-rev/clash-verge-rev
- Clash Verge Rev organization: https://github.com/orgs/clash-verge-rev/repositories
- v2rayN: https://github.com/2dust/v2rayN
- NekoRay/NekoBox for PC: https://github.com/MatsuriDayo/nekoray
- NekoBox for Android: https://github.com/MatsuriDayo/NekoBoxForAndroid
- Hiddify App: https://github.com/hiddify/hiddify-app
- sing-box: https://github.com/SagerNet/sing-box
- mihomo general configuration docs: https://wiki.metacubex.one/en/config/general/
- mihomo API docs: https://wiki.metacubex.one/en/api/
- MetaCubeXD: https://github.com/MetaCubeX/metacubexd
- jinqians/snell.sh: https://github.com/jinqians/snell.sh
- clash-nyanpasu: https://github.com/libnyanpasu/clash-nyanpasu
