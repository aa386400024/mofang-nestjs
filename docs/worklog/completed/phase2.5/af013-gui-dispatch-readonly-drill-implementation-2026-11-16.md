---
taskId: AF-013
contextId: phase2.5-orchestration-closed-loop
title: GUI 派发只读演练（进程自愈、四层定位、路径固化、失败重试与转人工、派发审计）
type: verification
status: completed
baselineRef: 7b75137
dependsOn: [AF-010, AF-011]
policyRefs: [framework/human-in-the-loop.md, framework/reliability.md, autonomous-team-design.md#gui-channel]
createdAt: 2026-11-16
---

# AF-013 · GUI 派发通道规则固化与只读演练 — 交付记录

- **状态**：✅ 已交付（2026-11-16，本机闸门全绿；编排层单测 89 passed）
- **基线 HEAD**：`7b75137`（与 `origin/integrate` 一致）
- **编排**：主控 Doubao（orchestrator 自做）｜**任务性质**：通道规则固化 + 真实桌面只读演练；演练子任务 `DR-001` 为纯只读调研，业务源码零改动
- **方案契约**：`docs/team/agent-orchestration/autonomous-team-design.md` §3（派发通道）、§7（autoLoop 阶段 2 前置）、§8 P0-5；框架仓 `docs/human-in-the-loop.md` §4、`docs/reliability.md` §3/§4/§6

---

## 一、本单做了什么（一句话）

把 GUI 派发的进程自愈、四层定位、会话降级链、重试上限、转人工判定与派发审计收口为 `dispatch-channel.mjs` 纯规则模块（进程 / 剪贴板 / 窗口 IO 留注入接口位，模块内零 IO、可替身单测）；CLI 新增只读 `channel` 子命令；并在本机桌面用只读调研子任务 `DR-001` 真实跑通「队列检查 → 进程发现启动 → 健康探测 → 定位降级 → 粘贴发送校验 → 回执落盘回收」全链路，审计只留路径 / 计数 / 结果，不落对话原文。

## 二、改动文件清单

| 文件                                                                                     | 改动                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/orchestration/dispatch-channel.mjs`（新增）                                     | 常量 `CHANNEL_GUI`、`SESSION_PATHS`（`existing-session → mini-chat → new-task`）、`LOCATE_LAYERS`（`health → element-tree → shortcut → paste-verify`）、`MAX_START_RETRIES=1`、`MAX_SEND_RETRIES=1`、`ACTIVE_DISPATCH_STATUSES`、`DISPATCH_RESULTS`；纯函数 `nextSessionPath`、`nextLocateLayer`、`canDispatch`（队列互斥，自身在办不阻断）、`resolveDispatchDecision`（登录门 / 进程拉起 / 窗口重启 / 逐层定位 / 沿链发送 / 超限升级人工）、`buildDispatchAudit`（只收路径 / 计数 / 结果 / 原因，**不接收消息正文**）、`summarizeChannelOutcomes`（按会话路径聚合计数与成功率，空态 `successRate=null`）、`buildEscalationMessage`（对齐 human-in-the-loop §4 字段：taskId / currentStatus / attemptedPaths / failureEvidence / options≥2 / recommendedDecision） |
| `scripts/orchestration/cli.mjs`                                                          | 导入通道常量与 `canDispatch`；新增 `cmdChannel` 与 `channel` 子命令：`rules`（打印降级链 / 定位层 / 重试上限 / 队列纪律）、`queue --taskId X`（单任务队列可派判定）；纯只读，不落审计、不触发变更；case 分支与帮助行已注册                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `scripts/orchestration/__tests__/orchestration.spec.mjs`                                 | 新增 AF-013 测试段 7 例：降级链顺序与链尾 null；队列互斥三态（无在办放行 / 他人在办阻断 / 自身在办不阻断）；决策登录门优先转人工、进程 / 窗口按重试上限拉起超限升级；就绪后逐层定位、沿会话链发送、发送超限升级；审计合法构造且不含正文 + 非法枚举拒绝；路径成功率聚合（空态 null）；升级消息字段齐全 / 缺证据 / 选项不足 / 缺决定点被拒                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `docs/team/agent-orchestration/improvement-log.json`                                     | 登记候选 IM-014、IM-015（见 §五）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `docs/team/agent-orchestration/orchestration-snapshot.json`、`web/orchestration/data.js` | CLI 双写刷新（台账条目与队列快照同步）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### 2.1 口径对齐（框架与设计备忘真相源）

- **进程自愈**（§3.1）：派发前探测进程 / 窗口；未开启经应用目录发现并启动，启动失败重试一次（`MAX_START_RETRIES`）；真正不可恢复才保持任务 `ready`、写审计并升级 Human。
- **定位四层**（§3.2）：窗口健康 → 元素树 → 快捷键（Mini Chat → 新任务页）→ 剪贴板粘贴 + 结果校验（文本进框、消息入流、输入框清空）；逐层降级。
- **会话降级链**（§3.3）：旧会话追加（默认）→ Mini Chat 小窗 → 主窗口新建任务页；链尾返回 `null`，决策升级人工。
- **文件交接**（§3.4）：GUI 只传 taskId 与交接件 / 回执路径，不贴长简报；交接件结构复用 AF-009 契约，派发接线复用 AF-010。
- **审计纪律**（§3.5）：通道、会话路径、定位层、尝试次数、结果、时间戳、原因；不含对话原文。
- **框架对齐**：`reliability.md` §3 失败定性、§4 重试上限与超时不自动重派、§6 崩溃恢复（上下文从状态索引 + 工件重建）；`human-in-the-loop.md` §4 升级消息标准字段与单一决定点。

### 2.2 真实桌面演练记录（基于截图与文件证据，非印象判定）

| 步骤             | 观察证据                                                                                                                                                                                                                   | 结论                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 队列检查         | 派发前 `list_cron_jobs` 在途轮询 = 0                                                                                                                                                                                       | 队列空闲，满足单任务队列纪律                                                            |
| 进程发现与启动   | `list_apps` 命中 `MiniMax Code`；`launch_app` 返回 `accepted_unverified`，等待约 3 秒后窗口到前台                                                                                                                          | 进程自愈路径可用                                                                        |
| 健康探测（L1）   | 截图确认已登录（账号栏 `MiniMax890956 Explore`），对话界面正常，无登录门                                                                                                                                                   | 窗口健康；未触发人工接管                                                                |
| 旧会话定位（L2） | 旧会话输入框两次坐标点击落在对话流 / 左侧空白，输入框未聚焦；`Ctrl+A` 选中历史消息，粘贴落空                                                                                                                               | 坐标定位未命中，按降级链离开 `existing-session`；该路径未发送，不计入派发成功或失败终态 |
| 快捷键定位（L3） | `Ctrl+Shift+M` 唤起 Mini Chat 浮层，输入框自动聚焦；剪贴板简报粘贴入框，截图确认文本完整可见                                                                                                                               | 降级至 `mini-chat`，定位成功（`shortcut` 层）                                           |
| 发送校验（L4）   | `Enter` 发送；截图确认简报作为新气泡入流（新会话「未命名会话」），输入框清空，执行方进入思考中                                                                                                                             | 消息入流 + 输入框清空，发送成功                                                         |
| 回执落盘回收     | 交接件 `transport/tasks/DR-001.json`（`investigation` 只读调研）；约 135 秒后回执落盘 `docs/worklog/pending/archive/relay-response-af013-drill-20261116.md`，13 718 字节；回执自检 `git diff --stat HEAD -- src test` 为空 | 回执回收闭环；演练全程零业务源码改动                                                    |

**本次派发审计记录**（运行态口径；字段与 `buildDispatchAudit` 一致，不含正文）：

| taskId | channel | sessionPath | locateLayer | attempt | result     | 备注                                                            |
| ------ | ------- | ----------- | ----------- | ------- | ---------- | --------------------------------------------------------------- |
| DR-001 | gui     | mini-chat   | shortcut    | 1       | dispatched | 旧会话坐标定位未聚焦，降级 Mini Chat 后一次发送成功；未触发重试 |

> 路径成功率口径：本次为单条样本，`existing-session` 定位未成功即降级、未在该路径发送，不记为派发失败；模块 `summarizeChannelOutcomes` 对空态返回 `successRate=null`，不把单轮观察夸大成路径成功率统计。

### 2.3 零改动确认

- `src/engine-core/`、`src/migration/`、`src/**/*.ts` 业务代码、整个 `test/`、`bin/` —— **零 diff**（回执自检与本地 `git diff --stat HEAD -- src test` 双重确认）。
- **未新增第三方依赖**；未改动 `package.json` / lockfile；演练交接件 `transport/` 为 gitignore 运行态，不进提交。
- 向后兼容：既有子命令与调用签名未改；`channel` 缺省动作为只读 `rules`；进程 / 窗口 / 剪贴板 IO 未在模块内实现，由 CLI / relay 层经注入接口调用，单测不起真实桌面。

## 三、关键决策与偏差

1. **纯规则与执行 IO 分离**：降级选择、队列判定、决策动作、审计构造、成功率聚合全部纯函数可单测；进程探测、窗口操作、剪贴板与发送留在 relay / 桌面层，便于替身测试与后续替换通道。
2. **审计结构拒绝正文**：`buildDispatchAudit` 入参不含 `messageText`，从构造层杜绝对话原文落审计；升级消息同样只承载路径、证据、选项与决定点。
3. **队列互斥按在办状态判定**：`submitted / working` 为在办；除自身外存在在办任务即阻断，避免 executor 多任务上下文混乱（对齐 AF-010 单任务队列）。
4. **决策优先级固定**：登录门 > 进程拉起 > 窗口重启 > 逐层定位 > 沿会话链发送 > 超限升级人工；每级带重试上限（启动 1、发送 1），超限保持 `ready` 并升级 Human，不自动登录、不填凭证。
5. **旧会话坐标定位失败如实记录**：Electron 输入框位置随窗口尺寸与历史消息变化，坐标不稳；本次实测两次未聚焦，降级快捷键路径成功。后续默认优先快捷键 / 元素树，坐标点击仅作兜底（与 §3.2 分层顺序一致）。
6. **偏差**：无。任务单 §2 范围内落地；多任务并行派发、常驻守护进程、MCP / HTTP 通道、实现类任务的闸门与合并验证均未越界实现（归后续阶段）。

## 四、闸门证据

| 命令                                                                          | 退出码 | 结果                                                                                                                                |
| ----------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`（`tsc -b tsconfig.check.json`）                              | 0      | 0 error                                                                                                                             |
| `pnpm lint:fast`（`oxlint src test bin`）                                     | 0      | 0 warning / 0 error，1350 文件                                                                                                      |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0      | 89 passed（基线 82 + AF-013 新增 7）                                                                                                |
| 编码探测                                                                      | —      | 改动 `.mjs` / `.json` / `.md` / `data.js` 均 `bom=False`、纯 LF（`cr=0`）                                                           |
| CLI 只读试跑                                                                  | 0      | `channel rules` 输出降级链 / 定位层 / 重试上限 / 队列纪律；`channel queue --taskId AF-013` 输出「可派发：AF-013（无其他在办任务）」 |

- **未重跑全量**：改动不进入 `src/test` 运行时，沿用基线全量口径；编排层定向单测已覆盖新模块全部纯函数路径。桌面演练本身不跑业务闸门（任务单 §5）。

## 五、遗留与未决

- **IM-014（candidate · framework · gap · review）**：通道层重试规则与失败终态未锚定 framework `reliability.md` §4（各自立法）。回执发现重试形态 / 数值（固定重试一次、无退避）与框架指数退避不一致；失败终态出口双轨（保持 `ready` + 转人工 vs 直接 `failed`）；确定性缺陷在通道层缺终止规则。跨两仓文档修订时统一权威终态出口与任务级重试预算。
- **IM-015（candidate · framework · gap · review）**：派发审计缺逐次重试留痕载体与失败定性三分法字段。当前只留尝试次数聚合值；通道失败未纳入确定性 / 偶发 / 既有债定性；框架要求的基线分栏在通道侧无载体。
- **回执 12 条差异 / 缺口与 5 个开放问题**：见 `docs/worklog/pending/archive/relay-response-af013-drill-20261116.md` §差异表与 §遗留；本单不就地修订（outOfScope），优先级建议 D-10（补锚点）→ D-5（定权威终态出口）→ D-2 / D-4（统一重试预算与退避）→ D-1 / D-3（补定性字段与逐次留痕）。
- **通道演练基线口径**：只读零代码任务无可比代码基线；演练失败时区分「既有通道债」与「本次引入」的基线来源需另立只读核对单确认（回执 D-8）。
- **后续 P0 依赖链**：AF-013 依赖 AF-010 / AF-011（均已交付）；AF-014 独立，紧接本单落地。

## 六、审计链与回写清单

- [x] 交付记录落固定路径；任务单与交付记录成对归档 `completed/phase2.5/`
- [x] 索引状态迁移追加 `history`，工件指针（任务单 / 交付记录 / 回执）填全
- [x] 快照与看板 data.js 经 CLI 双写刷新；通道规则为只读视图，变更动作归后续 relay 层审计
- [x] `taskId`（AF-013 / 演练子任务 DR-001）贯穿任务单 / 交接件 / 回执 / 交付记录 / 台账关联 / commit message
- [x] 并行线产物 `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md` 未混入本单 stage；运行态 `transport/`、`orchestration-store.sqlite`、`tool-audit-log.json` gitignore 不入库
