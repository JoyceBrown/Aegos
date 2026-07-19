# Aegos 3.6.35 开发交接文档

- 更新时间：2026-07-19
- 软件代码基线：`v3.6.35` / `4491695090ff90bec7007ca4965d32b71cbdb5d8`
- 远端仓库：`https://github.com/JoyceBrown/Aegos`
- 目标读者：接手 Aegos 后续开发、测试、发布和安全维护的开发者

---

## 0. 使用规则与事实优先级

本文件用于替代长聊天上下文。接手后不要继续依赖旧账号的聊天记录，也不要从历史版本号反推“功能一定完成”。

事实优先级从高到低如下：

1. 当前 Git 提交中的可执行代码、测试和配置。
2. 当前远端 `main`、当前标签和 GitHub Release。
3. 本交接文档以及当前仍被代码引用的契约文档。
4. 当前版本 Release Note 和实测记录。
5. 历史 Roadmap、旧 Release Note、研究资料，仅用于理解来路，不得直接作为当前任务。

发生冲突时，以代码和可复现实测为准。发现文档与代码不一致时，不得选择对自己更容易的一方；必须定位差异、修正文档或实现，并留下验证证据。

安全边界：本文件不包含真实订阅 URL、token、节点地址、节点密码、控制器 secret、个人路径、诊断导出或账号凭据。后续也不得把这些内容写进仓库、Issue、截图、日志样例或 Release Note。

---

## 1. 软件说明与产品目标

Aegos 是面向 Windows 10/11 x64 的桌面代理客户端，技术栈为 Tauri 2、Rust、原生 HTML/CSS/JavaScript、WebView2，以及由 Aegos 管理的 Mihomo 数据面。

Aegos 的产品目标不是让普通用户理解 Mihomo、YAML、策略组、Controller、TUN 路由和 Windows 代理注册表，而是让用户完成真实任务：

- 导入订阅并可靠连接。
- 5 秒内看懂是否已经代理成功、由什么方式接管、当前出口是什么。
- 测速但绝不自动连接、切换节点或改变模式。
- 指定网站或应用走自动策略、固定节点、直连或阻止。
- 出错时看到具体原因、下一步动作和可验证的修复结果。
- 后台测速、诊断、订阅更新和落地 IP 查询运行时，页面和导航始终可操作。
- Aegos 崩溃、被强制结束或配置应用失败后，Windows 网络环境能够恢复。
- 日志和诊断可以用于排查，但默认不泄露敏感信息。

长期定位：Aegos 拥有控制面、产品语义、任务调度、配置事务、Windows 系统接管、诊断和恢复；Mihomo 是当前经过验证的数据面引擎，不是 Aegos 的产品定义。

不要走两个极端：

- 不要把 Aegos 做成“启动 Mihomo 后套一层 UI”的薄壳。
- 不要为了证明“不是套壳”而重写成熟协议栈，或不断增加没有用户收益的 Adapter/Runtime 包装层。

每次所谓“能力内化”必须改善至少一个可测指标：首次测速时间、结果首屏时间、导航响应、状态一致性、配置回滚成功率、崩溃恢复成功率、错误可解释性或安全边界。没有可测收益的抽象不得合入。

---

## 2. 当前 Git、GitHub 与发布基线

### 2.1 Git 基线

- 交接编写时的本地分支：`release/3.6.35`
- 远端默认分支：`main`
- 软件发布提交：`4491695090ff90bec7007ca4965d32b71cbdb5d8`
- 软件发布标签：`v3.6.35`
- 本文件应作为 `v3.6.35` 之后的仅文档提交进入 `main`；不得移动或改写发布标签。
- 完成交接提交后，`v3.6.35` 仍指向 `4491695`，`origin/main` 可以比它多一个交接文档提交。
- 交接检查开始时工作树干净，性能复测生成文件已经恢复，仅本文件属于预期变更。
- 远端仅公开 `main` 和 `v3.6.35`，不要把本地历史实验分支直接推到公开仓库。

交接后首先执行：

```powershell
git fetch --prune --tags origin
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
git tag --points-at HEAD
git merge-base --is-ancestor v3.6.35 HEAD
git diff --name-only v3.6.35..HEAD
```

刚完成本次交接时，最后一条 diff 应只包含本交接文档；后续开发提交出现后不再适用这一限制。

### 2.2 GitHub 基线

- 仓库：`JoyceBrown/Aegos`
- 可见性：Public
- 默认分支：`main`
- GitHub 仓库 ID：`1304769624`
- 最新 Release：`v3.6.35`
- Release 资产：`Aegos_3.6.35_x64-setup.exe`

公开仓库在交接前经过干净重建。远端 249 个可达提交经 Gitleaks 扫描无泄漏，旧敏感提交 SHA 和 Raw 文件均不可访问。后续不得恢复、合并或强推旧的未清洗历史。

### 2.3 版本与制品

- `package.json`：`3.6.35`
- `src-tauri/Cargo.toml`：`3.6.35`
- `src-tauri/tauri.conf.json`：`3.6.35`
- 安装包大小：`16,088,860` bytes
- 安装包 SHA-256：`F8027159954AF35A45BB475CB544D3468C75328159D11F8D065D826ABA2B68A9`
- 安装方式：NSIS，current-user
- WebView2：缺失时使用可见的 download bootstrapper

三个版本号必须始终一致。版本号只在对应用户目标、证据和 Release Note 都完成后推进。

### 2.4 Mihomo 数据面基线

- 文件：`resources/core/mihomo.exe`
- 版本：`Mihomo Meta v1.19.28 windows amd64`
- 构建：Go 1.26.5，`with_gvisor`
- 大小：`47,942,656` bytes
- SHA-256：`C14BDA8DC4CC8910CCD2110FE2BE083C51A1B66DA59141A0B87AFF6FE6126517`

升级核心不能只替换二进制。必须验证协议、配置预检、Controller 契约、测速、TUN、DNS、规则、崩溃恢复、安装包体积、第三方许可证和回滚路径。

---

## 3. 开发环境与构建

基线环境：

- Windows 10/11 x64
- Node.js `v24.18.0`
- npm `11.16.0`
- Rust `1.96.1`，项目最低 `rust-version = 1.77`
- MSVC Rust target
- Visual Studio C++ Build Tools
- WebView2 Runtime
- TUN 场景需要管理员权限

初始化与构建：

```powershell
npm ci
npm run check
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

安装包输出：

```text
src-tauri/target/release/bundle/nsis/Aegos_3.6.35_x64-setup.exe
```

`node_modules/`、`src-tauri/target/`、日志、临时文件、本地设置和凭据都已被 `.gitignore` 排除。不要为了“方便测试”把构建产物或用户配置加入 Git。

---

## 4. 当前页面与真实用户任务

### 首页

展示统一运行时快照：当前节点、落地 IP、延迟、稳定性、活跃连接、上传下载、系统代理/TUN 接管和异常提示。连接按钮先做本地即时反馈，再由后端快照校正。

### 节点页

用于订阅切换、策略组查看、节点搜索/筛选/排序、收藏、编辑、单节点测速、批量测速和节点到规则的快捷联动。

普通订阅必须显示全部匹配节点。极大订阅使用虚拟列表，只限制同时存在的 DOM 行数，不得截断数据。策略组引用和内置策略不能伪装成普通节点。

### 连接页

展示活动连接、目标、规则链、上传下载，并允许安全关闭连接。读取连接不得阻塞导航。

### 规则页

当前支持普通用户创建网站规则、应用规则，选择自动、手动、固定节点、直连或阻止；支持预览、冲突检查、测试、启用/禁用、编辑、删除、排序和应用失败回滚。系统规则只读并解释用途。

尚未实现专业的“规则源码/脚本编辑工作区”，详见后续路线。

### 订阅页

支持 URL/URI/Base64/Clash YAML 等来源，支持 SS、Trojan、VLESS、TUIC、AnyTLS、Hysteria2 等当前能力矩阵内协议。导入、更新、切换必须预检并可回滚，切换后旧测速和旧落地 IP 任务不得污染新订阅。

### 诊断页

诊断与日志已经合并为同一产品页面。普通用户先看 Aegos 错误码、问题分类、解释和修复动作；技术日志是内部证据视图。修复动作采用 allowlist 后台任务，完成后重新验证。导出默认脱敏。

### 设置页

管理系统代理、连接后自动接管、TUN、断网保护、局域网开放、端口、日志级别、可靠性恢复和环境检查。高级项默认收起；进入设置页不得自动执行重型环境检查。

当前 DNS 设置语义不完整：界面的“DNS 防泄漏”实际只控制 TUN `any:53` 劫持，Aegos 运行配置仍会启用托管 DNS。后续必须改成明确的 DNS 模式，而不是再加一个含糊开关。

---

## 5. 架构总览

```text
用户操作
  -> 前端本地状态/乐观反馈
  -> Tauri invoke 命令
  -> 后台 Job 或只读查询
  -> Aegos 领域模型与事务
  -> 配置预检 / Windows 接管 / CoreController
  -> Mihomo 数据面或 Windows 系统状态
  -> Aegos 验证结果
  -> 统一 runtime snapshot / job snapshot / structured issue
  -> 前端局部渲染
```

### 5.1 前端

- `src/index.html`：页面语义结构和稳定 DOM 锚点。
- `src/styles.css`：设计 token、组件样式、响应布局和历史覆盖层。
- `src/app.js`：Tauri 调用、页面状态、缓存、任务轮询、渲染和事件处理。

前端不能直接访问 Mihomo Controller，不能解析/写入运行 YAML，不能把本地设置猜测成运行真相。动态用户/核心文本必须使用 `textContent`、文本节点或安全创建函数；禁止 `innerHTML`、`insertAdjacentHTML` 和同类动态注入。

当前债务：`app.js` 约 7,769 行，`styles.css` 约 6,477 行，仍是大型单体。拆分时必须先建立命令轨迹和行为夹具，迁移一条、删除一条，禁止长期保留新旧双路径。

### 5.2 Rust 控制面

核心模块职责：

| 模块 | 责任 | 备注 |
|---|---|---|
| `main.rs` | Tauri 命令、总编排、CoreManager、应用生命周期 | 约 13,401 行，当前最大结构债 |
| `core_runtime.rs` | Mihomo Controller 边界、运行时语义、启动/重启、错误分类、Windows 计划 | 不得继续只加无收益包装层 |
| `core_domain.rs` | 流量、节点、策略组、连接等类型化快照 | UI 不直接消费原始 Controller JSON |
| `config_domain.rs` | ProfileCatalog、手动节点和运行配置报告 | 产品元数据不得泄露凭据 |
| `profile_compiler.rs` | 订阅源到单次部署计划的编译 | 同次部署不得重复解析生成不同结果 |
| `config_pipeline.rs` | 端口、DNS、TUN、默认组、隐藏规则、手动节点、预检 | 配置策略唯一入口 |
| `config_deployment.rs` | 候选配置、原子提升、日志、验证、回滚和启动恢复 | 配置写入安全事务 |
| `task_runtime.rs` | Job 状态、进度、取消、过期清理 | 长任务统一入口 |
| `speed_runtime.rs` | 测速状态、健康缓存、运行代际、可信度 | 与节点选择状态分离 |
| `speed_scheduler.rs` | 固定 worker、协议族并发限制、取消和优先级 | 慢协议不能拖死整批 |
| `subscription_runtime.rs` | 订阅解析、下载、格式/协议诊断 | 仅使用脱敏 fixture |
| `routing_domain.rs` | 规则/策略组命令与类型化校验 | 负责语义，不负责随意写 YAML |
| `routing_store.rs` | 用户规则存储、scope 和顺序 | 全局规则与订阅规则分离 |
| `diagnostics_runtime.rs` | Aegos issue、日志分类、脱敏导出 | 原始核心错误不能直接作为普通文案 |
| `system_takeover.rs` | 系统代理/TUN/防火墙事务日志和恢复 | Windows 状态变化必须可验证、可恢复 |

### 5.3 Aegos 与 Mihomo 的边界

Aegos 拥有：

- 用户设置和产品状态。
- 订阅、规则、手动节点和策略组的产品模型。
- 后台任务、取消、超时和旧结果失效。
- 配置候选、预检、原子提升、运行验证和回滚。
- Windows 系统代理、TUN、防火墙、快照和崩溃恢复。
- 用户可理解的错误码、诊断和日志脱敏。

Mihomo 负责：

- 代理协议和网络数据面。
- Controller 提供的延迟、节点、连接、流量、规则命中等底层能力。
- TUN 数据面和核心配置执行。

Mihomo 返回成功不等于产品操作成功。Aegos 必须继续验证 Controller、运行身份、当前节点、网络可用性和 Windows 接管状态后才能向用户宣告成功。

---

## 6. 关键状态、任务和事务模型

### 6.1 统一状态快照

`app_status` 是首页、侧栏、设置、诊断和连接按钮的共同事实来源。

必须区分：

- 核心进程存在。
- Controller 已就绪。
- 系统代理/TUN 已按用户意图应用。
- 流量接管完整。
- 最近网络探测确认可用。
- 当前出口 IP 是新鲜结果还是旧缓存。

禁止用 `settings.systemProxy` 证明系统代理已经应用，禁止用 `coreReady` 证明用户已经可以联网。

### 6.2 后台 Job

慢操作使用 `start_job` + `job_status`：核心启停、订阅操作、模式/节点切换、设置应用、诊断、修复和落地 IP 等。

基本规则：

- 页面切换、日志查看、节点浏览永远是前端动作，不进入网络互斥锁。
- 互斥只限制冲突的网络变更，不得锁全局 UI。
- pending 状态只作用于发起按钮、行或任务中心。
- 可取消任务收到取消后必须停止新工作；旧代际结果不得写回。
- 任务失败必须结束 pending，并带结构化错误，不得永久显示“处理中”。

当前 `JobStore` 使用短临界区 `Mutex<HashMap<...>>`。不要为了“lock-free”标签盲目重写；先用 profile/trace 证明锁竞争。外部 HTTP、PowerShell、核心等待和测速不得在 `CoreManager` 大锁内执行。

### 6.3 配置部署事务

唯一允许的链路：

```text
订阅源/用户规则/手动节点/设置
  -> ProfileCatalog / typed input
  -> RuntimeDeploymentPlan
  -> ConfigDeploymentCandidate
  -> 静态预检和 Mihomo 预检
  -> 写候选文件和回滚快照
  -> 原子提升
  -> 热重载/启动
  -> Controller、运行身份、节点和网络验证
  -> 完成日志，或配置+运行时回滚
```

禁止重新引入已经删除的平行配置入口，禁止把 Aegos 生成的 controller、TUN、DNS、隐藏规则写回原订阅源。

### 6.4 Windows 接管事务

系统代理、TUN 和断网保护必须：

1. 读取并持久化原状态。
2. 记录事务步骤。
3. 应用变更。
4. 读取系统实际状态验证。
5. 完成日志；失败则回滚。
6. 启动时恢复未完成事务；正常退出恢复 Aegos 拥有的状态。

不得删除或覆盖不属于 Aegos 的防火墙规则、PAC、代理例外或用户默认设置。

### 6.5 测速模型

- 批量/一键测速主目标：`https://www.gstatic.com/generate_204`。
- 单节点诊断可以使用更完整的 gstatic/Cloudflare HTTP+HTTPS 目标族。
- 测速只更新延迟、失败原因、健康度、可信度和推荐信息。
- 测速绝不连接、切换当前节点、修改模式、开启系统代理或 TUN。
- 首页一键测速与节点页批量测速必须共享同一运行和结果流。
- 已测试失败必须显示超时、DNS、TLS、认证、协议、核心或网络等具体原因，不能退回“未测速”。
- 切订阅立即取消旧代际，保留历史健康数据可以，但不得把旧进度和结果渲染到新订阅。

---

## 7. 已完成并必须继续守住的策略

以下表示“当前实现存在并有门禁”，不表示以后可以不复测。

### 产品状态与交互

- 首页、侧栏、设置和诊断使用统一运行时语义。
- 连接按钮有即时 pending、成功校正、失败原因和恢复动作。
- 诊断、测速、订阅任务和落地 IP 查询不锁导航。
- 后台任务在状态中心可见但不遮挡主界面。
- 诊断和日志已经合并，日志不再是竞争性的顶级页面。

### 订阅与协议

- 支持 Clash YAML、URI 列表和常见 Base64 订阅。
- 当前覆盖 SS、Trojan、VLESS、TUIC、AnyTLS、Hysteria2 等能力矩阵。
- 导入/更新有格式和协议诊断，配置替换使用事务。
- 缺少 Proxies/自动组的订阅会生成 Aegos 默认组；Proxies 应包含全部真实节点。
- 订阅元数据伪节点会在运行和测速前清理。

### 节点与测速

- 启动后由 Aegos 在运行时与节点快照就绪后发起一次后台首测。
- 用户手动测速会抑制重复自动首测。
- 固定 worker、协议族限制和可取消调度避免慢 TUIC/AnyTLS 拖死整批。
- 测速结果增量返回；首页和节点页共享结果。
- 普通列表不再有 24 行截断；8,000 节点 fixture 使用可达的虚拟列表。

### 规则

- 网站/应用规则向导、策略选择、预览、冲突解释和测试路径已存在。
- 用户规则优先于普通订阅规则；不可覆盖的系统保护规则必须解释。
- 用户规则支持启用、禁用、编辑、删除和排序。
- 系统规则只读，说明落地 IP、Aegos 服务和防泄漏用途。
- 规则应用经过预检、部署、验证和失败回滚。

### 安全与恢复

- Controller 默认本地绑定，secret 生成，`allow-lan` 默认关闭。
- Tauri capability 当前仅包含 `core:default` 和窗口拖动权限。
- 配置和日志写入限制在受管目录并采用原子替换。
- 诊断/日志/公开订阅摘要默认脱敏。
- 防火墙、系统代理和 TUN 有事务记录与启动恢复。
- 动态 HTML 注入在生产前端被审计禁止。

### 仅有契约、尚未产品化

- Provider healthcheck：有契约和审计，当前不在 UI、运行时或普通测速中调用。
- 多核心：只有边界研究，当前只支持 Mihomo，不得宣称可替换核心已经完成。
- 规则脚本：尚无受限执行环境和 UI，不得开放任意 JavaScript/PowerShell。

---

## 8. 不可破坏约束

以下约束优先于功能进度和版本号：

1. 测速绝不连接或切节点。
2. 系统代理开关本身不自动连接；连接和接管是不同用户意图。
3. 诊断、测速、订阅更新、落地 IP 和环境检查不得锁死导航。
4. 切订阅/切节点后旧任务不得写回新状态。
5. 同一个状态不能在不同页面出现互相矛盾的结论。
6. 配置变更必须预检、原子写入、运行验证和失败回滚。
7. 系统代理/TUN/防火墙必须保存原状态、验证应用并在失败或退出时恢复。
8. UI 不直接访问 Controller，不暴露 secret，不解析运行 YAML。
9. 动态内容禁止危险 HTML 注入。
10. 订阅 URL、token、节点凭据、个人路径、公网/局域网信息不得进入公开日志和 fixture。
11. 不得通过放宽超时、删除断言、减少测试数据或隐藏错误来让门禁通过。
12. 不得保留新旧双实现“以后再清”；迁移完成必须删除旧路径。
13. 不得通过新增大锁、在锁内等待网络/PowerShell 或同步长任务换取代码简单。
14. 不得为了“高级架构”增加无指标收益的包装层。
15. 不得直接复制 GPL 项目的代码、图标、样式或可识别布局。
16. 不得用“脚本通过”替代真实安装包和真实 Windows 用户路径。

---

## 9. 不可绕过的完成定义与验收标准

### 9.1 “完成”必须同时满足

一个任务只有同时满足以下条件才能标记完成：

- 用户目标完成：普通用户知道入口、结果和下一步。
- 正常路径真实可用，不是仅渲染了按钮或静态数据。
- 失败路径有分类、解释、恢复或安全退出。
- 连续点击、切页、切订阅、取消和超时不会产生旧结果污染。
- 后台工作不阻塞无冲突的浏览和导航。
- 网络/配置/系统状态变化有验证和回滚。
- 日志、错误和导出经过脱敏。
- 大数据、空状态、加载、部分成功、失败和 stale 状态都有覆盖。
- 有与风险匹配的 Rust test、fixture、audit、smoke 和人工路径证据。
- Release Note 记录计划目标、实际实现、偏差、证据和剩余风险。

缺少任何一项，应写“部分完成”或“未完成”，不能推进版本号来掩盖。

### 9.2 禁止低效通过和偷懒方式

- 审计只检查字符串存在，不能证明真实行为；必须补行为测试。
- fixture 通过不能证明真实 WebView2、Wintun、杀毒软件或机场节点环境通过。
- 单次性能通过不能证明稳定；性能门禁至少串行三轮。
- 删除失败节点、降低节点数、增加全局超时不能冒充测速优化。
- 把后台任务从按钮移走但仍在全局锁内等待，不算非阻塞。
- 用缓存显示旧落地 IP 但不标 stale，不算快速响应。
- reload 返回 200 但网络未验证，不算配置部署成功。
- 系统开关布尔值变化但 Windows 实际状态未验证，不算接管成功。
- UI 看起来完整但按钮无真实后端闭环，不算产品完成。

### 9.3 每个 PR/任务的证据模板

```text
用户任务：
修改前可复现问题：
根因：
修改边界：
未修改边界：
正常路径证据：
失败/超时/取消证据：
并发与旧任务证据：
回滚/恢复证据：
安全与脱敏证据：
性能前后指标：
自动测试：
真实 Windows 人工路径：
剩余风险：
回退方式：
```

### 9.4 日常门禁

基础代码变更至少运行：

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
npm run check
cargo test --manifest-path src-tauri/Cargo.toml
npm run audit:security
npm run audit:copy
```

涉及交互、状态或后台任务：

```powershell
npm run smoke:interactions
npm run audit:responsiveness
npm run audit:runtime-regression
```

涉及规则：运行相关 Stage 3、routing、config-domain 和 config-deployment 门禁，并完成真实规则增删改、预检、应用、失败回滚路径。

涉及 Windows 接管：运行 takeover、stage5、installer-regression，并人工验证系统代理/TUN/防火墙应用与恢复。

涉及发布：

```powershell
npm run smoke:perf:repeat
npm run smoke:soak
npm run audit:installer
npm run audit:release
```

性能、UI、soak 必须串行运行，不能与其他 Chrome/WebView2 测试并行争用资源。

---

## 10. 交接日验证结果

验证时间：2026-07-19，基线提交 `4491695`。

### 已通过

- Rust：158 passed，0 failed。
- `npm run smoke:interactions`：全部 10 类用户旅程通过；测速导致的切节点/连接副作用为 0。
- `npm run audit:security`：通过。
- `npm run audit:runtime-regression`：通过。
- `npm run audit:release`：通过。
- `npm run audit:copy`：生产代码可疑乱码 0，危险动态 HTML 0。
- `npm run audit:config-deployment`：通过。
- `npm run audit:system-takeover-stage5`：通过。
- `npm run audit:diagnostics-stage6`：通过。
- `npm run audit:stage3-acceptance`：通过。
- `npm run audit:installer`：安装包、版本、大小和 SHA-256 通过。
- `npm run smoke:perf:repeat`：串行 3 轮通过；状态内容最坏约 153.8 ms，首页节点内容最坏约 262.7 ms，视觉导航 P95 最坏约 16.8 ms，布局偏移 0，测速流 P95 最坏 50 ms。

### 需要诚实保留的异常

1. 单独第一次 `smoke:perf` 出现测速流帧 P95 66.7 ms 的失败；立即独立复测通过，正式 3 轮 repeat 也通过。这说明无头软件合成器仍有单轮波动，不能只跑一次后挑选通过结果。真实 WebView2 仍需人工性能矩阵。
2. `npm run audit:current-mainline` 当前失败两项：
   - 它用脆弱正则截取 `refresh_outbound_ip_detached`，并期待旧表达式 `current_proxy != selected_proxy`；当前实现已经使用 query generation、profile、mode 和当前代理复核，并在缓存 fallback 前返回。功能路径存在，但审计解析器与实现脱节。
   - `RELEASE_3.6.35.md` 没有记录该旧主线门禁要求的三段固定文字。

不得把上述失败隐藏。下一版本首先修复审计为结构/行为检查，并在新 Release Note 中记录真实证据；不要修改或重写已发布的 `v3.6.35` 标签来伪造历史。

另一个证据质量提醒：`audit:stage3-acceptance` 是阶段保留门禁，输出仍引用 3.6.0 checkpoint 安装包且 hash 为空。当前安装包由独立 `audit:installer` 正确验证。后续应让阶段门禁明确“契约保留”和“当前制品验证”的区别。

---

## 11. 已知问题与风险清单

### P0：进入下一发布前处理

1. **修复 `audit:current-mainline` 的脆弱实现**
   改为 AST/结构检查或行为测试，验证节点变化后旧落地 IP 查询不会返回缓存，而不是匹配某一行旧源码文本。

2. **完成 3.6.36–3.6.40 成熟验收**
   当前发布停在 3.6.35。安装卸载、多协议真实矩阵、其他 Windows 设备、剩余风险清单和成熟候选包尚未完成，不能宣称 3.6.40 已完成。

3. **许可证与分发合规收口**
   仓库没有项目根级 `LICENSE`；需要由所有者决定 Aegos 自身许可证。Mihomo 是独立数据面二进制，发布前必须补齐其许可证、源码对应关系/获取方式、版本和分发义务记录。Fluent 图标已有 MIT 许可证和 pinned commit 记录。

4. **账号权限交接**
   使用 GitHub Collaborator、组织权限或仓库 Transfer，不得共享 PAT、密码、2FA 或 Git Credential Manager 内容。

### P1：近期产品与架构任务

1. **规则源码/脚本编辑工作区缺失**
   最佳位置是规则页内部全宽二级工作区：`可视化规则 | 源码编辑 | 脚本`。Monaco 仅在进入高级编辑时懒加载。源码应用必须走现有配置事务。脚本不得直接开放任意 PowerShell/Shell/无限制 JavaScript；先定义沙箱、权限、超时、内存、文件系统、网络白名单、日志脱敏和失败隔离。

2. **DNS 产品语义不完整**
   当前 `config_pipeline::harden_runtime_dns` 始终启用 Aegos DNS、`fake-ip` 和指定上游；“DNS 防泄漏”开关只影响 TUN 的 `any:53` 劫持。应改成 `自动（推荐）/安全接管/系统 DNS（兼容）/自定义 DNS` 模式，并显示实际解析器、接管状态和泄漏检测。TUN+系统 DNS 必须警告或提供明确防泄漏策略。

3. **IPv6 自动模式仍不完整**
   当前有本机/节点/出口/泄漏检查和 IPv4 fallback 语义，但 UI 的 IPv6 开关被禁用，尚未形成完整“自动接管、节点不支持则阻断泄漏并回退”的产品闭环。

4. **`main.rs`、`app.js`、`styles.css` 仍过大**
   拆分目标是减少职责混合、重复渲染和补丁覆盖，不是增加层数。每次拆分必须有命令轨迹 parity、行为 fixture、性能对比和旧路径删除。

5. **CoreManager 仍有粗粒度互斥区**
   已将部分 HTTP、LAN IP 和测速外部工作移到锁外，但核心启动、订阅部署和回滚等事务仍可能让只读查询排队。用 trace 确认热点后缩短临界区；不要把必要事务拆成不一致的无锁状态。

6. **后台状态仍以轮询为主**
   长期可把测速、任务和状态变更逐步改为事件推送+版本快照，保留低频兜底轮询。必须防止事件风暴、乱序和恢复后丢事件。

7. **真实 Windows 性能观测不足**
   Chrome fixture 能守住 DOM、任务和调度上限，但不能代表 WebView2、GPU 驱动、Wintun、杀毒软件和不同 DPI。需要 native trace、冷启动和真实设备矩阵。

8. **Provider healthcheck 尚未上线**
   契约明确但没有实现运行时/UI。上线前必须证明不改变当前节点、`selected_proxy_map`、系统代理、TUN 和流量接管。

9. **签名、自动更新和发布渠道未产品化**
   当前安装包可用但未在本交接基线中证明代码签名、自动更新、回滚更新和稳定/测试渠道。

### P2：中长期

- 托盘、后台驻留和开机启动的完整退出恢复。
- 受控多核心研究，但在当前 Windows/Mihomo 主线稳定前不接第二数据面。
- macOS/Linux 平台抽象，只能先做研究或隔离原型。
- 手动节点现代协议字段和迁移导入继续补齐。
- Provider、连接、规则命中和诊断信息的高级视图，不能把普通 UI 变成 Mihomo Dashboard。

---

## 12. 后续路线

### 第一优先：完成当前成熟主线

#### 3.6.36 安装卸载审计

- 首次安装、覆盖安装、WebView2 缺失、普通/管理员账户。
- 卸载前后系统代理、PAC、TUN、路由、防火墙和 app-data 行为。
- 强制结束后再卸载的恢复路径。
- 安装包与卸载器均不能泄露本机信息。

#### 3.6.37 多订阅、多协议真实测试

- SS、Trojan、VLESS、TUIC、AnyTLS、Hysteria2。
- 同订阅、同网络、同 TUN 状态对比导入、连接、批量测速、单节点测速、失败原因和落地 IP。
- 记录成功率、首结果时间、全部完成时间、UI 帧和协议差异。
- 测不通必须分类，不能写“未测速”。

#### 3.6.38 其他 Windows 设备矩阵

- Windows 10/11、不同 DPI、普通/管理员账号。
- WebView2 版本、显卡驱动、杀毒/防火墙、其他 VPN/代理软件冲突。
- 安装、连接、TUN、系统代理、测速、规则、诊断、退出和恢复。

#### 3.6.39 剩余风险清单

每项必须写：影响、触发条件、可检测信号、用户规避、修复计划、负责人、是否阻塞发布。禁止只写“存在少量风险”。

#### 3.6.40 成熟候选安装包

只有前述证据通过后发布。不得用当前静态审计脚本数量冒充成熟度。

### 第二优先：成熟基线后的产品增量

1. 规则页高级源码编辑器，先只做安全的草稿、格式化、差异、预检、应用和回滚。
2. 脚本能力先写威胁模型和受限 DSL/沙箱 RFC，不直接执行系统脚本。
3. DNS 模式产品化，替换含糊的“DNS 防泄漏”二元语义。
4. IPv6 自动接管和防泄漏闭环。
5. Provider healthcheck 只读实现与单独缓存。

### 第三优先：结构性优化

- 前端先抽 typed service，再抽 feature renderer；每次只迁移一类调用。
- 将 `main.rs` 的命令编排、Windows 平台操作和领域状态进一步拆开。
- 用版本化事件减少轮询，但保留恢复快照。
- 用实测决定锁优化，不追求形式上的 lock-free。
- 继续减少 Controller 往返的性能关键路径，但不绕过 Aegos 产品验证。

---

## 13. 开源项目吸收规则

开源吸收仍然有效，但 `research/` 是研究池，不是自动执行计划。

允许吸收：

- 官方 API 语义和公开协议。
- 可验证的产品策略和测试方法。
- 经过许可证审查的依赖。
- 使用 Aegos 自身模型重写的交互原则。

默认禁止：

- 直接复制 GPL 客户端代码、图标、样式和布局。
- 为了“像 FlClash”复制实现而不做同场景指标对比。
- 引入第二 UI 框架或第二核心而没有 RFC、迁移和回退。
- 执行服务端 shell 脚本或默认 root 操作。

每个吸收任务必须记录来源、commit/version、license、要吸收的具体能力、Aegos 当前差距、实现边界、安全风险、bundle 影响、维护状态、移除计划和验收证据。

---

## 14. 发布流程

1. 从已同步的 `main` 创建单一目标分支。
2. 先写用户目标、失败路径和验收证据，再写实现。
3. 保持 package/Cargo/Tauri 版本一致。
4. 完成 Rust、audit、interaction、performance repeat、soak 和真实 Windows 路径。
5. 生成 NSIS 安装包。
6. 计算 SHA-256，并与 Release Note、installer audit 对齐。
7. 安装新包完成一次真实用户路径。
8. 提交代码与 Release Note，确认工作树干净。
9. 推送 `main`，创建 annotated tag。
10. 创建 GitHub Release、上传安装包，再匿名验证仓库和下载链接。

Release Note 至少包含：用户问题、根因、实际修改、未改边界、验证命令、真实路径、安装包信息和剩余风险。

---

## 15. 账号与协作交接

推荐方式：

- 原账号在 GitHub 仓库 Settings 中把新账号加入 Collaborator，或转入双方可管理的 Organization。
- 若要更换所有者，使用 GitHub Transfer，并在转移后核对默认分支、Release、Actions、Security、Topics 和下载链接。
- 新账号使用自己的 SSH key/PAT/Git Credential Manager。
- 不共享旧账号密码、PAT、2FA、恢复码或浏览器会话。
- 权限交接后执行一次只读 fetch，再通过 PR 推送一个文档变更验证权限，不直接强推 `main`。

建议分支与合并策略：

- `main` 保持可构建、可测试。
- 一个分支只处理一个用户目标或一个可独立回退的架构迁移。
- 禁止把功能、视觉重做、核心升级和大规模重构放在同一个 PR。
- 涉及网络系统状态的 PR 至少一名开发者复核回滚和权限边界。

---

## 16. 重要文档读取顺序

新同事建议按以下顺序阅读：

1. `README.md`
2. 本文件 `DEVELOPMENT_HANDOFF_3.6.35.md`
3. `AGENTS.md`
4. `DEVELOPMENT_GUARDRAILS.md`
5. `core-api-contract.md`
6. `STATUS_SNAPSHOT_CONTRACT_3.5.75.md`
7. `speed-target-contract.md`
8. `docs/ui/UI_RUNTIME_FLOW.md`
9. `docs/ui/INTERACTION_STATES.md`
10. `docs/performance/PERFORMANCE_ROOT_CAUSE_AND_PLAN_3.6.32.md`
11. `RELEASE_3.6.35.md`

历史 `ROADMAP_*`、`RELEASE_*`、`ARCHITECTURE_*` 和 `research/*` 只能用于追溯决策。不要重新按旧版本号从头执行，也不要把旧计划中未落地的句子当成当前能力。

---

## 17. 首周接手清单

### 第一天

- 核对 Git/GitHub/Release 基线。
- 使用新账号完成 clone、fetch、测试和只读 Release 下载。
- 跑 158 个 Rust tests、security、copy、interaction。
- 不修改网络逻辑，先阅读事务和状态契约。

### 第二至三天

- 修复 `audit:current-mainline` 脆弱解析器，增加落地 IP 旧任务行为测试。
- 建立 3.6.36–3.6.40 的真实设备和协议测试表。
- 完成项目与 Mihomo 分发许可证决定。

### 第四至五天

- 运行安装/卸载、崩溃恢复、TUN、系统代理和防火墙人工路径。
- 串行运行 performance repeat 和 soak。
- 输出剩余风险，不急于新增高级编辑器或 DNS 模式。

首周验收：新同事能够解释一次连接、测速、订阅切换、规则应用和系统代理恢复分别经过哪些状态、锁、任务、事务和回滚路径，而不是只会修改按钮和文案。

---

## 18. 最终开发原则

每次停下前必须回答：

- 用户看到的是否真实？
- 用户是否知道下一步点哪里？
- 失败是否有原因、动作和恢复？
- 后台任务是否影响无冲突操作？
- 是否可能污染 Windows 网络？
- 是否能够回滚并验证回滚？
- 是否泄露订阅、节点、系统或个人信息？
- 是否有真实行为和真实环境证据？
- 是否删除了被替代的旧路径？
- 是否改善了用户可感知或可测指标？

只要其中一项不能明确回答，任务就还没有完成。
