# 自主团队闭环设计备忘（双代理派发 · 分支治理 · 分层发布与回退）

> 本文件是 mofang-nestjs 适配层的编排演进设计口径；角色模型、状态机、验收五类、回执七字段、可靠性规则以框架仓 `docs/roles.md`、`docs/state-machine.md`、`docs/acceptance.md`、`docs/reliability.md`、`docs/autonomous-loop.md` 为准，本文件只记录本项目的通道落地、分支策略、并发互斥、发布分层与分期边界，不复制通用规则正文。
>
> 目标：人只定目标、优先级与约束；方案讨论与执行由 orchestrator（Doubao）与 executor（MiniMax Code）自主闭环，验收与归档自动推进；受保护动作与对外发布仍由 Human 拍板。

## 1. 现状基线

### 1.1 已具备机制

| 机制                                                         | 落点                                                                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 角色卡与能力声明                                             | `agent-cards/orchestrator.json`、`executor.json`（human 属 `nonRoutableRoles`，不产卡，边界见 `agent-cards/README.md`） |
| 九态状态机、任务租约、超时释放                               | `scripts/orchestration/scheduler.mjs`                                                                                   |
| 验收五类与机读护栏 V1–V6                                     | `acceptance-runner.mjs`、`acceptance-checklist.md`                                                                      |
| 回执七字段、交付记录模板                                     | `relay-receipt-template.md`；框架仓 `docs/receipt-contract.md`                                                          |
| 改进台账、工具审计、Store 端口、文件 Transport、watcher 防抖 | `improvement-log.mjs`、`audit-log.mjs`、`store-port.mjs`、`transport.mjs`、`file-watcher.mjs`                           |
| 提交钩子                                                     | `.husky/pre-commit`（lint-staged：oxlint + prettier）、`.husky/commit-msg`（conventional 正则）                         |
| 远端 CI                                                      | `.github/workflows/ci.yml`：lint+typecheck、unit 分片、e2e、coverage、Docker build、security audit                      |

### 1.2 待补缺口

| #   | 缺口             | 现状                                                                                                                                                                                |
| --- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | 派发通道半自动   | 主控写长简报 → 人工粘贴到 MiniMax → cron 轮询回执；人卡在粘贴与盯回执两步                                                                                                           |
| G2  | 派发未接调度器   | `claimReadyTasks` 只登记租约，不产生派发记录；`transport.submitTask` 未被调度调用                                                                                                   |
| G3  | 缺文件切片互斥   | 只有任务级租约，无可写文件域前置校验；双代理同改一个文件无拦截                                                                                                                      |
| G4  | 方案协商轮未固化 | researcher / critic 为预留角色，双代理方案讨论无结构化轮次                                                                                                                          |
| G5  | 自治循环关闭     | `config.autoLoop.enabled=false`，队列不自动推进                                                                                                                                     |
| G6  | 发布口径未分层   | README §2/§4 现写「AI 不自动 commit / push」，未区分任务分支、集成分支与对外发布；**已闭环（AF-014，2026-11-16）**：README §2/§4、三份角色卡 limits、任务单模板已对齐 §6.1 分层口径 |

## 2. 目标闭环链路

对齐框架 `autonomous-loop.md` §2 循环阶段；状态迁移与留痕遵守 `state-machine.md` §4。

```text
目标（Human：目标 / 优先级 / 约束）
  → ① 拆解：orchestrator 出任务单（切片、scope.files、依赖、门禁、基线）
  → ② 协商（可选）：executor 提第二意见 / 风险 / 替代思路 → orchestrator 裁决；分歧冻结转 Human
  → ③ 派发：按能力声明路由 → 租约落盘 → 任务契约经通道送达 → 派发记录留痕
  → ④ 执行：executor 在切片文件域内实现 + 内循环自测 + 交付记录 / 回执（不提交、不推送）
  → ⑤ 验收：回执落盘触发；机读护栏 + 抽跑复现 + 五类核对 → 归档 / 返修 / 死信
  → ⑥ 下一单；队列空 → 交付包；冻结动作、终态、对外发布回交 Human
```

## 3. 派发通道（GUI 自动化 + 文件交接）

### 3.1 进程自愈（未开启则自动拉起，不首选转人工）

重试与失败定性通用规则以框架 `reliability.md` §4（§4.1 可恢复 / 不可恢复、§4.2 失败定性三分法）为准，本节只记录通道落地口径：

1. 派发前先探测执行代理进程 / 窗口是否存在；
2. **未开启时自动启动**：经应用目录发现并 `launch_app` 拉起，等待窗口就绪；启动失败在任务级预算内重试；
3. **终态出口（对齐 §4.1）**：不可恢复类别（契约不成立 / 输入非法 / 权限不足 / 确定性缺陷）直接置 `failed`、不重试；可恢复瞬时故障在预算内降级重试，耗尽后保持 `held-ready`（任务仍为 `ready`）升级 Human，不直接置 `failed`；登录门优先交人工接管；
4. 可恢复故障按指数退避序列等待（纯数据序列见 `dispatch-channel.mjs` `BACKOFF_MS`；实际等待由 relay 层执行，通道规则层不 sleep）；不在首轮就把启动问题抛给人。

### 3.2 输入框定位四层（不靠坐标盲点）

| 层                 | 动作                                                                                    | 退化方向                         |
| ------------------ | --------------------------------------------------------------------------------------- | -------------------------------- |
| L1 健康检查        | 确认窗口在对话界面（输入框占位符特征可探测）                                            | 异常进 L2/L3                     |
| L2 元素树优先      | 读快照可交互元素树定位输入框，按元素索引操作                                            | 元素树不可用进 L3                |
| L3 快捷键兜底      | `Ctrl+Shift+M`（Mini Chat，输入框自动聚焦）→ `Ctrl+N`（主窗口新任务页，输入框固定聚焦） | 快捷键失败进 L4                  |
| L4 粘贴 + 结果校验 | 长文本走剪贴板；粘贴后确认文本进输入框；发送后确认消息进入对话流且输入框清空            | 失败重试一次换路径；仍失败转人工 |

**重试预算（对齐 `reliability.md` §4.1 任务级单一限次）**：通道以任务级总尝试次数封顶（`dispatch-channel.mjs` `MAX_TOTAL_ATTEMPTS`）；定位层切换与会话路径切换各计一次尝试；进程 / 窗口启动与发送的局部重试上限受总预算封顶，不叠加出独立于任务级的第二套限次。

### 3.3 会话选择降级链

旧会话追加（上下文连续，默认）→ Mini Chat 小窗（新主题）→ 主窗口新建任务页（兜底）。降级路径切换计入任务级尝试次数（见 §3.2 预算口径）；链尾仍未成功即预算内最后一条路径，耗尽后按 §3.1 终态出口处理。

### 3.4 契约文件化（通道只传 taskId，不贴长简报）

| 交接面             | 落点                               | 写入方       | 读取方                   |
| ------------------ | ---------------------------------- | ------------ | ------------------------ |
| 任务契约           | `transport/tasks/<taskId>.json`    | orchestrator | executor                 |
| 回执               | `transport/receipts/<taskId>.json` | executor     | orchestrator（验收触发） |
| 方案意见（协商轮） | `transport/reviews/<taskId>.json`  | executor     | orchestrator（裁决）     |

GUI 会话只传递一句话：交接文件绝对路径 + 回执路径。任务上下文从文件重建，对齐 `reliability.md` §6 崩溃恢复口径，不依赖对话历史。

### 3.5 派发审计

每次派发记录通道、会话路径、尝试次数、结果、失败原因（`reason`）、时间戳，落现有工具审计日志；回执轮询带超时与租约释放，超时不自动重派（`reliability.md` §3）。

- **终态出口映射**：不可恢复 → `failed`；可恢复重试耗尽 → `held-ready`（升级 Human）；登录门 → `human-escalated`；成功 → `dispatched`。出口判定与不可恢复类别枚举见 `dispatch-channel.mjs`，通用规则锚定 `reliability.md` §4.1。
- **失败定性（对齐 §4.2）**：每次通道失败按确定性缺陷 / 偶发波动 / 既有债三选一记录；既有债基线与本次改动分栏（`baseline.legacyDebt` / `baseline.changeIntroduced`），不混记。
- **逐次留痕**：审计保留 `attempts` 数组，每次尝试记录定位层、会话路径、原因、退避毫秒、结果与时间戳；聚合 `attempt` 只作计数，复盘以逐次条目为准。
- **重派策略（对齐 §3）**：超时任务附原因转人工或按重试规则处理，不自动重派；非超时可恢复失败保持 `ready`，是否重派由 orchestrator 显式触发，通道层不自行重排。
- **熔断 / 死信预留位**：复用框架 §5 扩展位语义，本版本不实现通道侧独立熔断计数与隔离区；阈值参数化归 P2。
- **通道演练基线**：只读零代码任务无可比代码基线；演练基线取「稳定路径清单 + 当日各路径成功率快照」两者，用于区分既有通道债与本次引入（对齐 §4.2 基线当场复核）。

### 3.6 角色能力路由与资源域护栏（AF-016）

- **能力路由（IM-008）**：派发前按 Agent Card 声明选择目标代理——`availability` 非 `available` 不入选；按 `skills` / `tools` 命中交集评分；显式指定角色优先，显式角色不可用时保留该角色并透出原因，不擅自改派；无显式角色时按能力匹配。匹配明细（命中 / 缺失 skill、tool）随派发记录的 `route` 透出，供审计复盘。
- **资源域越域校验（IM-010）**：任务 `scope.files` 须落在目标角色 Card `resources` 资源域前缀内；越域文件清单透出并拦截派发。只读 / 调研 / 评审 / 验证类任务豁免。资源域真相源保持 Agent Card `resources` 与框架 `roles.md`，脚本不另抄目录白名单；任务间文件域互斥仍归 §5。

## 4. 分支策略与治理

### 4.1 分支分层

| 类型 | 分支                   | 职责                                  | 自动化口径                                                              |
| ---- | ---------------------- | ------------------------------------- | ----------------------------------------------------------------------- |
| 长期 | `master`               | 受保护对外基线                        | 只接受 release PR（release 分支 + 12 项必需检查）合并与 tag；不接受直推 |
| 长期 | `integrate`            | 集成分支，自动流水线落点，CI 在此运行 | 任务分支验收合并的落点                                                  |
| 短期 | `task/<taskId>-<slug>` | 单任务实现切片                        | 一单一分支，合并后即删                                                  |

**命名口径**：`task/<taskId>-<slug>`。任务类型前缀（feat / fix / docs）由 conventional commit message 承担，分支名不重复；分支名必须含 taskId，保证台账可反查与批量清理。

### 4.2 分支数量治理（六道）

1. **合并即删**：squash merge 回 integrate 后删除本地与远端源分支；`archivedTasks` 条目记录分支名，归档时触发清理。
2. **陈旧巡检**：脚本列出「已合并进 integrate」的本地 / 远端分支一键清理；未合并分支保留并提示超期；采集 `ahead/behind` 差量，未合并且落后基线（behind>0）的分支单独标注「待 rebase」，不与超期 stale 混同。
3. **并发上限封顶**：单 executor 队列同时只有 1 个任务分支；P2 并行时分支数 = 并行任务数，由调度器并发上限控制。
4. **命名强约束**：分支名必须含 taskId；禁止无编号临时分支。
5. **squash 合并**：一个任务一个提交，integrate 历史保持线性（契合本仓现状：历史以线性提交为主，无 merge commit 包袱）。
6. **远端同步清理**：不残留 stale remote-tracking 分支。

### 4.3 边界

- executor 不建分支、不提交、不推送；分支由 orchestrator 在派发时创建、验收后合并清理。
- 冲突在任务分支内解决，不把 merge commit 带进 integrate。
- 任务分支基线从 `integrate` 最新 HEAD 切出；合并前核对 `baselineRef` 与当前基线一致（`reliability.md` §6.3）。

### 4.4 `development` 分支退役（已完成 2026-11-16）

新流程长期分支只保留 `master` + `integrate`。2026-11-16 已完成退役：`origin/development` 独有非 merge 提交 0 条，`git diff integrate...development` 为空；已删除本地与远端 `development`，CI push 触发同步收敛为 `master` / `integrate`（AF-019）。

## 5. 并发与文件域互斥

1. **文件域前置声明**：任务单 `scope.files` 列出可写文件 / 目录；派发前与在办任务的文件域做交集校验，有交集 → 排队或冻结，不并行派发。
2. **任务级租约**：沿用现有机制；同 `contextId` 串行；租约期内其他方不得领取。
3. **残留文件识别**：验收 / 提交前比对 git diff 文件清单与任务 scope；清单外文件判残留，不进提交分组（`reliability.md` §6.5）；发现他人未提交改动交叉 → 暂停转人工。变更清单由 run-once / watch 入口经 git 端口采集 `git diff --name-only HEAD` 传入验收护栏（V7）；清单为空时 V7 记 skip，不阻断。
4. **写幂等**：taskId + 工件版本；重复派发回执「在办 / 已完成」，不重复执行。
5. **并行维度**：起步单 executor 串行队列；只读调研（researcher）与实现（executor）可并行；实现任务之间仅当文件域无交集时并行。多代理并行属 P2，前置为文件域锁升级与分支隔离跑通。

## 6. 分层发布与回退

### 6.1 发布分层（自动化逐层收紧）

| 层  | 动作                                       | 自动 / 人工                                         | 前置条件                                   |
| --- | ------------------------------------------ | --------------------------------------------------- | ------------------------------------------ |
| L1  | 任务分支提交                               | 自动（验收后由 orchestrator 提交，executor 不提交） | pre-commit 钩子 + 收尾闸门绿               |
| L2  | 推送任务分支到 origin                      | 可自动                                              | 闸门绿、验收五类通过、分支命名合规         |
| L3  | squash merge 进 integrate + 推送 integrate | 可自动                                              | 本地等价闸门全绿、无文件域冲突、提交可回退 |
| L4  | master 合并、tag、release、对外部署        | **人工**                                            | 冻结动作，对齐 `autonomous-loop.md` §3.2   |

L4 的当前执行载体是 `.github/workflows/release.yml`：只能从 `integrate` 手动触发，`dry_run` 默认 `true`；真实发布走 release 分支 → 合并 `master` → 对 release 分支显式 dispatch 完整 CI（12 项 required contexts）→ PR → 合并 → annotated tag / GitHub Release / GHCR。生产 `deploy` 需同时满足 `deploy=true`、`dry_run=false` 且 release job success，当前保持未启用。详见 [AF-022 交付记录](../../worklog/completed/phase2.5/af022-release-protection-compatible-implementation-2026-11-17.md)。

### 6.2 L3 过渡口径

本机无 gh CLI、无 GITHUB_TOKEN，远端 CI 状态本机不可读。过渡方案：

- 合并依据 = 本地等价闸门（typecheck + lint + vitest 定向 / 全量 + build）全绿 + 验收五类通过 + 无文件域冲突；
- 远端 CI 作事后复核；CI 转红则冻结后续派发并告警，不继续合入；
- P2 接入 token / gh 后，改为以 CI 状态作为自动合并门禁。

### 6.3 回退五道保障

1. **原子粒度**：一个任务一个提交 / 分支，回退粒度 = 单任务，不混任务提交。
2. **标准回退**：按 taskId 定位提交；首选 `git revert <sha>`（保留历史、不改写已推记录）；未推送的才用 `git reset`；失败任务分支删除重来。
3. **基线核对**：合并前核对 baselineRef 与当前基线一致，不一致不合并。
4. **闸门门禁**：闸门红不合并；已合并后 CI 转红冻结后续派发。
5. **冻结清单不自动**：release PR 合并、tag、release、对外部署、策略例外、路线选型、跨任务变更、验收分歧、新增未声明依赖 → 转 `input-required` 等 Human 决策。

### 6.4 既有口径同步记录

**已同步（AF-014，2026-11-16）**：README §2 角色绑定与 §4 敏感操作、`agent-cards/` 三份角色卡 limits、`wp-task-template.md` §2/§4/§7 已由旧口径「AI 不自动 commit / push」改为引用 §6.1 分层口径：L1–L3 在闸门与验收通过等前置条件下由 orchestrator 自动，L4 保留人工。分层定义唯一真相源留在本节 §6.1，README / 角色卡 / 模板只引用不复制正文。

**已同步（AF-015，2026-11-16）**：§3 派发通道锚定框架 `reliability.md` §4——补任务级重试预算与降级计次、指数退避序列、不可恢复四类终态出口、失败定性三分法与基线分栏、逐次重试留痕载体、重派策略与熔断 / 死信预留位口径；通用规则正文留框架 §4，本节与 `dispatch-channel.mjs` 只落地通道侧枚举、预算与审计字段。

**已同步（AF-016，2026-11-16）**：§3.6 落地角色能力路由（IM-008：availability 门槛 + skill/tool 评分 + 显式角色优先、不可用不改派）与角色资源域越域校验（IM-010：scope 落在 Card `resources` 前缀内，只读类豁免）；§4.2 巡检补 ahead/behind rebase 标注（IM-013）；§5 残留识别补 git diff 采集入口接线（IM-009：run-once / watch 采集清单传入 V7，空清单 skip）。纯函数落 `card-router.mjs` / `branch-workflow.mjs`，调度与 CLI 仅做注入接线，未碰业务 `src/`。

**已同步（AF-017，2026-11-16）**：改进台账抽取通道补回执正文解析（IM-001）：`extractFromReceiptDoc` 解析回执 markdown 遗留组 `backlogItems` / `openQuestions` 列表项转候选草稿，与 `extractFromSnapshot` 快照结果按标题键 + 签名合并去重；`manualReviewList` 仍归快照通道，避免双源重复；CLI `--extract` 枚举归档回执 `relay-response-*.md` 接入双通道。纯函数落 `improvement-log.mjs`，文件 IO 归 CLI，未碰业务 `src/`。

## 7. autoLoop 开启时机

| 阶段                 | 状态                                                                           | 条件            |
| -------------------- | ------------------------------------------------------------------------------ | --------------- |
| 阶段 1（现状）       | `autoLoop=false`，只读快照，人工 run-once                                      | —               |
| 阶段 2（演练通过后） | 文件域校验、回执监听、任务分支流程在只读任务上跑通；本地闸门全绿；审计留痕齐全 | P0 交付         |
| 阶段 3（开启）       | 先限单任务队列、限文档 / 低风险类型；观察若干单稳定后放开 `implementation`     | 阶段 2 稳定运行 |

## 8. 分期路线

对齐框架 `evolution.md` 档位：任务 / 状态 / 工件契约不变，分期只改承载与调度。

### P0 编排层与通道演练（不碰业务源码）

| 编号 | 事项                                                                                      | 产出                         |
| ---- | ----------------------------------------------------------------------------------------- | ---------------------------- |
| P0-1 | 交接契约 schema（tasks / receipts / reviews JSON 结构）；transport 目录接线               | `transport/` 目录 + 契约定义 |
| P0-2 | claim 接 `submitTask`，派发记录落盘；watcher 扩展监听 `receipts` 目录，回执事件触发验收轮 | 调度器 + watcher 改动        |
| P0-3 | `scope.files` 文件域校验 + 在办任务交集检查                                               | 任务单校验 + 调度器拦截      |
| P0-4 | 任务分支流程脚本：建分支、squash 合并、合并清理、陈旧分支巡检                             | CLI / 脚本                   |
| P0-5 | GUI 派发演练（只读零代码任务）；固化稳定路径与失败重试 / 转人工规则；派发审计             | 演练回执 + 通道规则          |
| P0-6 | README §2/§4 与角色卡 limits 口径同步到分层发布模型                                       | 文档 / 声明件修订            |

### P1 半自动闭环

1. relay 改「交接文件 + taskId」短指令；watcher 事件驱动替代 cron 轮询；
2. 方案协商轮固化：决策点写回 `reviews/<taskId>.json`，orchestrator 裁决，分歧冻结；
3. 任务分支自动合并进 integrate（本地闸门绿为前提）；回退脚本与 taskId → 提交映射台账；
4. `development` 分支退役（已完成 2026-11-16，见 §4.4）。

### P2 并行与远端联动

1. 文件域锁升级为可并行的版本号 / 文件锁；多 executor 并行；
2. gh / token 接入，PR 流与 CI 状态门禁；
3. mcp / http Transport 实现位落地；researcher / critic 角色按需绑定；熔断阈值参数化。

## 9. 冻结动作与升级消息

冻结类别沿用框架 `autonomous-loop.md` §3.2：对外发布、策略例外、路线选型、跨任务变更、验收分歧、依赖变更。升级消息携带标准字段：任务标识、归组标识、当前状态、已尝试路径、失败证据、可选方案与建议决策点（`human-in-the-loop.md` §4）。

## 10. 边界与不做项

- 本备忘不改框架通用契约；任务单字段、状态枚举、回执字段、验收五类、工件不可变规则保持不变。
- 不引入协议栈依赖；MCP / HTTP 通道仅保留扩展位（`transport.mjs` 现状）。
- P0 不开启多代理并行、不接远端 CI 门禁、不退役分支以外的重构。
- 自动合并不等于跳过验收：五类核对与抽跑复现仍是 L3 前置条件，执行侧「已通过」自述不作为验收依据。
