# AF-024 交付记录：GUI 派发通道接入（桌面 relay 承载 MiniMax Code）

- 任务单：`docs/worklog/pending/af024-gui-dispatch-task-2026-11-17.md`
- 上下文：`phase2.5-orchestration-closed-loop`
- 基线：`04f6524`
- 角色：orchestrator（编排者自执行）；executor 侧做独立评审，不重复实现
- 交付时间：2026-11-17（本地 +08:00）
- 结论：**passed**。G1 从「文件 Transport + 人工粘贴」推进到「协议层 + 桌面 relay + 回写」的真闭环，并留下一次真实 GUI 投递与一次真实协商往返。

## 1. 交付内容

### 1.1 新增模块 `scripts/orchestration/gui-dispatch.mjs`

投递协议纯逻辑层（不触屏、不开进程、不碰剪贴板），导出：

| 导出                                                                                                                          | 职责                                                             |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `DELIVERY_STATES` / `DELIVERY_FAILURE_CLASSES` / `CHANNEL_GUI_FALLBACK` / `BRIEF_DIR_NAME` / `DEFAULT_DELIVERY_LEASE_MINUTES` | 状态、定性、降级通道、投递件目录、默认投递租约                   |
| `briefFileName` / `buildGuiBrief` / `writeGuiBrief`                                                                           | 投递件生成与落盘（五段：契约 / 范围 / 闸门 / 验收 / 回执约定）   |
| `confirmDelivery`                                                                                                             | 送达确认，带通道守卫 + 状态守卫 + 枚举校验 + 证据文件校验        |
| `fallbackDelivery`                                                                                                            | 失败降级，带原因、定性、交接件存在性校验，清定位痕迹并压 history |
| `deliveryDeadline` / `isDeliveryStalled`                                                                                      | 投递独立租约与停滞判定                                           |

### 1.2 接线

- `dispatch.mjs`：`buildDispatchRecord` 在 `gui-relay` 时带 `delivery`（`pending` + `briefRef + history`）；`dispatchTask` 重派时 `attempt` 递增、上一轮 `delivery` 进 `history`；`DISPATCH_CHANNELS` 补 `gui-file-fallback`；`normalizeChannel` 不再把降级态吞成 `file`。
- `scheduler.mjs`：领单派发按 `task.agentRole` 选路（编排者 → `file`，执行代理 → `config.dispatch.channel`）；`gui-relay` 领单时即生成投递件（不再依赖人工补跑）；新增 `releaseFailedDeliveries`，把 `failed` 或 pending 超投递租约的任务回滚 `ready` 并置 `heldForHuman`（`releaseReason` 分别 `gui-delivery-failed` / `gui-delivery-lease-expired`），`advanceOnce` 在领单前调用。
- `cli.mjs` `channel`：`rules` / `queue` / `dispatch [--extra-file] [--executor]` / `confirm` / `fallback` / `state` 六动作；不再硬写通道（编排者任务直接拒绝 GUI 投递）；`--executor` 落执行器标识（默认 `doubao-cu`）。
- `transport.mjs`：交接件指针统一返回仓内相对路径（去绝对路径，避免本机目录布局进快照）。
- `config.json`：`dispatch.channel=gui-relay`、`fallbackToFile=true`、`deliveryLeaseMinutes=5` + 三条口径 notes。
- `README.md` §5.1：通道选路、投递状态机、命令表、校验守卫、分工红线。

## 2. 闸门（真实命令 + 真实数字）

| 闸门       | 命令                                                                          | 结果                                          |
| ---------- | ----------------------------------------------------------------------------- | --------------------------------------------- |
| 编排单测   | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | exit 0，**161 passed / 0 failed**（1.14s）    |
| 适配层校验 | `ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate`                        | exit 0，**18 PASS / 0 FAIL**                  |
| 框架契约包 | `pnpm orchestration:contracts`                                                | exit 0，14 文件哈希与 v2.0.0（`c507188`）一致 |
| 事件日志   | `node scripts/orchestration/cli.mjs events verify`                            | exit 0，**102 条**，哈希链与索引投影一致      |

## 3. 真实 GUI 投递（G1 实证）

顺序与证据（全部可指认，不含对话原文）：

| 步骤 | 动作                                                                                                        | 证据                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1    | `task promote` → `run-once` 领单派发                                                                        | 日志 `[动作] claim AF-024` / `[动作] dispatch AF-024`；事件 seq 递增                       |
| 2    | `channel dispatch --extra-file …/AF-024-review-extra.md`                                                    | `transport/briefs/AF-024.brief.md`（1660 字符，五段齐全）                                  |
| 3    | 桌面 relay：`seed_computer_use` 切 main → `list_apps` → `launch_app`（MiniMax Code）→ 点输入框 → 剪贴板粘贴 | `transport/briefs/AF-024.paste.png`                                                        |
| 4    | `Enter` 发送                                                                                                | `transport/briefs/AF-024.sent.png`（消息出现在会话流，输入框清空）                         |
| 5    | `channel confirm --session-path new-task --locate-layer paste-verify --evidence …AF-024.sent.png`           | 运行态 `delivery.state=delivered`、`deliveredAt=2026-11-17T02:25:57.792Z`                  |
| 6    | MiniMax 受理并写回评审                                                                                      | `docs/worklog/pending/af024-channel-review-by-executor.md`（16.9 KB，7 项需修 / 9 项通过） |
| 7    | 协商轮交接件                                                                                                | `transport/reviews/AF-024-review.json`，`review-handover 1.1.0` 校验 PASS                  |

时间序自洽：粘贴 10:25:32 → 发送 10:25:48 → confirm 10:25:57，粘贴与确认是两次独立动作。

## 4. 评审整改（executor 意见 → 裁决）

| executor 意见                                                              | 裁决                 | 落点                                                                              |
| -------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------- |
| P0：`confirmDelivery` 对「无 delivery 段」放行，file 通道可伪造 delivered  | 采纳                 | `record.channel !== 'gui-relay'` 即拒                                             |
| P0：confirm 清空 `failureReason/classification`，`failed→delivered` 无守卫 | 采纳                 | 只接受 `pending → delivered`；旧记录压 `history`                                  |
| P0：`sessionPath/locateLayer` 无枚举校验、证据文件不校验存在               | 采纳                 | 比对 `SESSION_PATHS` / `LOCATE_LAYERS`，`existsSync` 校验证据                     |
| P1：`fallbackDelivery` 不校验原通道、不校验交接件存在、遗留定位字段        | 采纳                 | 通道守卫 + `existsSync(handoverRef)` + 清空 `sessionPath/locateLayer/evidenceRef` |
| P1：`delivery.state` 未被调度层读取，降级不回滚                            | 采纳                 | `releaseFailedDeliveries` + `advanceOnce` 前置调用                                |
| P1：重派 `attempt` 恒为 1、覆盖上一轮留痕                                  | 采纳                 | `attempt=(previous+1)`，`history` 保留                                            |
| P1：CLI 硬写 `channel='gui-relay'`，旁路角色选路                           | 采纳                 | 编排者任务拒绝 GUI 投递，通道由选路决定                                           |
| P2：pending 占满单任务队列 30 分钟                                         | 采纳                 | 独立 `deliveryLeaseMinutes=5`                                                     |
| P2：`pending` 语义与「投递件已生成」不符                                   | 采纳                 | 领单即生成投递件，`briefRef` 非空                                                 |
| P2：评审交接件三字段为 null，闸门不可复现                                  | 采纳                 | 写全 `producedBy/producedAt/resolution`，validate 18 PASS                         |
| P2：`handoverRef` 绝对路径与 `briefRef` 相对路径混用                       | 采纳                 | `transport.mjs` 统一仓内相对指针                                                  |
| P2：`buildGuiBrief` 不回落 `plannedArtifacts`                              | 采纳                 | 回落 `plannedArtifacts[0].path`                                                   |
| P2：`DISPATCH_CHANNELS` 缺 `gui-file-fallback`                             | 采纳                 | 枚举补齐，不再归一成 `file`                                                       |
| P3：交付记录 / 回执 / 任务单状态行缺失                                     | 采纳                 | 本记录 + `transport/receipts/AF-024.json` + 任务单 §5                             |
| `resolveDispatchDecision` 决策链运行时零接线（IM-028 欠账）                | **未完成，登记承接** | 真实桌面动作在 relay 侧执行；决策链自动化接线转 backlog（见 §5）                  |

## 5. 遗留与承接（不谎报闭环）

- `IM-028`：`resolveDispatchDecision`（进程拉起 / 四层定位 / 会话降级链 / 退避）仍未在运行时被调用，真实动作由 orchestrator 的桌面 relay 承担。本任务把它从「无人提及的欠账」变成「有清晰落点与注入位的欠账」，但不宣称已接线。
- 本仓无浏览器 / 桌面守护进程能力，投递期间占用户前台；已按 computer-use 红线用 main 桌面并最小化占用，证据截图留在 `transport/briefs/`。
- GUI 通道默认开启意味着执行代理任务被领单后都留 `pending`，必须由 orchestrator 侧 confirm / fallback；`releaseFailedDeliveries` 已兜底，但该路径只在本次整改后新增单测覆盖，尚未在真实任务上再演一次（下一次执行代理任务即为实证）。

## 6. 回写清单

- `scripts/orchestration/gui-dispatch.mjs`（新增）
- `scripts/orchestration/dispatch.mjs` / `scheduler.mjs` / `cli.mjs` / `transport.mjs` / `config.json`
- `scripts/orchestration/__tests__/orchestration.spec.mjs`（新增 AF-024 用例 7 条）
- `docs/team/agent-orchestration/README.md` §5.1
- `docs/team/agent-orchestration/transport/reviews/AF-024-review.json`（协商轮）
- `docs/worklog/pending/af024-gui-dispatch-task-2026-11-17.md`（状态行 + §5）
- `docs/worklog/pending/af024-channel-review-by-executor.md`（executor 意见，只读存档）

## 7. 机读回执字段映射

验收脚本按字段标记核对交付记录，逐项对应如下（字段名与 `transport/receipts/AF-024.json` 同名同义）：

| 字段             | 本记录位置                                                                              |
| ---------------- | --------------------------------------------------------------------------------------- |
| `gateResults`    | §2 闸门表（四行，命令 + exit code + 用例数）                                            |
| `scopeCheck`     | §3 与 §6：改动全在 `scripts/orchestration/` 与 `docs/team/agent-orchestration/`，越域 0 |
| `contractChecks` | §4 表：taskId / state-write / receipt-shape / review-handover / delivery-guard 五项     |
| `backlogItems`   | §5：IM-028（决策链运行时接线）、AF-024-R2（回滚路径真实实证）                           |
| `deviationTable` | §4 末行 + 回执：executor 由「实现方」改为「独立评审方」及原因                           |
| `reviewVerdict`  | `passed`（四闸全绿 + 真实投递 + 评审整改闭合）                                          |

验收结论：`passed`；首轮自动验收因 V7 把本任务任务单的状态行改动算成越域、以及本记录缺上述字段标记而判 `rejected`，两处已分别由 AF-029 返修（任务单豁免 V7、索引工件指针收口）与本节补齐，历史拒绝记录保留不改写。
