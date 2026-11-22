---
taskId: AF-010
contextId: phase2.5-orchestration-closed-loop
title: 派发接线（claim 接 submitTask、派发记录落盘、watcher 监听 receipts 触发验收轮）
type: implementation
status: completed
baselineRef: 1e2d277
dependsOn: [AF-009]
policyRefs: [framework/state-machine.md, framework/reliability.md, framework/autonomous-loop.md]
createdAt: 2026-11-16
---

# AF-010 · 派发接线与回执 watcher — 交付记录

- **状态**：✅ 已交付（2026-11-16，本机闸门全绿；编排层单测 68 passed）
- **基线 HEAD**：`1e2d277`（与 `origin/integrate` 一致）
- **编排**：主控 Doubao（orchestrator 自做）｜**任务性质**：编排层工具链演进，业务源码零改动
- **方案契约**：`docs/team/agent-orchestration/autonomous-team-design.md` §2（闭环链路③④⑤）、§3.5（派发审计）、§8 P0-2

---

## 一、本单做了什么（一句话）

把「领单租约 → 写任务交接件 → 派发记录留痕 → 回执事件触发验收」链路接通：claim 成功后经注入式 Transport 投递 AF-009 契约交接件并落派发记录；watcher 增监听 `transport/receipts/`，回执事件触发一轮既有验收轮；派发与验收两侧分别落地幂等，重复派发不重复投递、重复回执不重复跑护栏。

## 二、改动文件清单

| 文件                                                                                     | 改动                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/orchestration/dispatch.mjs`（新增）                                             | 派发链路纯函数：`buildDispatchRecord`（通道 / 目标角色 / 会话指针 / 派发时间 / 租约截止 / 序号 / 状态 / 交接件指针）；`dispatchTask`（构造并校验交接件 → `transport.submitTask` → 写运行态 `dispatch` 记录；已派发不重复投递；契约非法不投递并返回错误清单）；回执幂等 `receiptFingerprint`（taskId + 交付记录指针）、`isReceiptProcessed`、`markReceiptProcessed`；导出 `DISPATCH_CHANNELS`；模块不直接读写仓内文件，Transport 由调用方注入 |
| `scripts/orchestration/scheduler.mjs`                                                    | `claimReadyTasks` 增 `opts.transport` 注入，领单后调 `dispatchTask` 并透出 `dispatch` / `dispatch-rejected` 动作；`processReceipts` 验收前按指纹判重跳过重复回执，验收后标记指纹；快照任务行投影 `dispatch` 只读段；状态枚举、迁移表、租约字段与既有超时释放逻辑未改                                                                                                                                                                         |
| `scripts/orchestration/cli.mjs`                                                          | 新增 `auditDispatchActions`：派发类动作逐条经 `TOOL-QUEUE-SCHEDULER` 工具契约落审计（correlationId `dispatch:<taskId>`、taskId、交接件指针）；`watch` 子命令监听目录增 `transport/receipts/`；run-once 与 watch 链路尾部调用派发审计                                                                                                                                                                                                         |
| `scripts/orchestration/__tests__/orchestration.spec.mjs`                                 | 新增 AF-010 测试段 6 例（首次派发字段齐全与交接件投递、重复派发幂等不重复投递、契约非法不投递、派发不触碰租约字段、回执指纹往返与判重、回执目录事件按路径去重）；快照段补 1 例派发记录只读投影断言（未派发为 null）                                                                                                                                                                                                                          |
| `docs/team/agent-orchestration/improvement-log.json`                                     | 登记候选 IM-007、IM-008（见 §五）                                                                                                                                                                                                                                                                                                                                                                                                            |
| `docs/team/agent-orchestration/orchestration-snapshot.json`、`web/orchestration/data.js` | CLI 双写刷新（台账条目与队列快照同步）                                                                                                                                                                                                                                                                                                                                                                                                       |

### 2.1 链路与状态迁移口径（对齐框架真相源）

- **派发阶段**（`autonomous-loop.md` §2 阶段 3）：`ready → submitted` 迁移与租约登记沿用既有 `claimReadyTasks`；交接件随派发下发，派发记录落运行态条目。状态不新增枚举，迁移表未改。
- **执行与回执阶段**（阶段 4）：执行代理写交付记录与回执；watcher 监听 `transport/receipts/`，防抖窗口内事件合并后触发一轮 `advanceOnce`；验收仍走既有 `processReceipts → runAcceptance`，未另造验收入口。
- **幂等**（`reliability.md` §2）：派发侧以 taskId 为主键，运行态已有 `dispatch` 记录即不重复投递；验收侧指纹 = taskId + 交付记录指针，同一交付记录重复投递只触发一次护栏。
- **租约**（§3）：`leaseClaimedAt` / `leaseDeadline` / `lastRunner` 由 claim 与超时释放管理；派发动作不触碰租约字段，超时释放不被派发绕过。

### 2.2 零改动确认

- `src/engine-core/`、`src/migration/`、`src/**/*.ts` 业务代码、整个 `test/`、`bin/`、`admin-dashboard/` —— **零 diff**。
- **未新增第三方依赖**；未改动 `package.json` / lockfile；MCP / HTTP Transport 预留位现状保持，未实现协议适配；未接远端 CI 状态。
- 既有行为向后兼容：`advanceOnce` 未注入 Transport 时内部按配置构造文件 Transport；`processReceipts` 无交付记录、非活跃态任务的分支不变；AF-005~009 既有测试不破坏。

## 三、关键决策与偏差

1. **派发逻辑独立成纯函数模块**：`dispatch.mjs` 不直接 IO，Transport 注入便于单测与后续替换；scheduler 只负责状态机接线，保持职责分层。
2. **契约校验前置到派发前**：承接 AF-009 决策 1——交接件在投递前经 `validateTaskHandover` 校验；校验失败不投递、返回错误清单并保留租约；状态回退属状态机职责，派发层不擅自迁移。
3. **两层幂等**：派发幂等（entry.dispatch 存在即跳过）与验收幂等（指纹判重）分离，分别覆盖「重复领单」与「重复回执」两类重复投递；指纹次键为交付记录指针（见 IM-007）。
4. **watcher 复用既有防抖与去重**：沿用 300ms 防抖窗口与 `dedupeEvents` 路径合并；receipts 事件只触发一轮调度，验收判定与归档仍归 `processReceipts`。
5. **派发审计复用既有工具契约**：不新增工具声明，派发动作挂 `TOOL-QUEUE-SCHEDULER`；派发记录只留通道、角色、指针与计数，不含对话原文。
6. **偏差**：无。任务单 §2 范围内落地；文件域互斥校验（AF-011）、GUI 自动化演练（AF-013）、任务分支流程（AF-012）未越界实现。

## 四、闸门证据

| 命令                                                                          | 退出码 | 结果                                                                                                   |
| ----------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| `pnpm typecheck`（`tsc -b tsconfig.check.json`）                              | 0      | 0 error                                                                                                |
| `pnpm lint:fast`（`oxlint src test bin`）                                     | 0      | 0 warning / 0 error，1350 文件                                                                         |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0      | 68 passed（基线 61 + AF-010 新增 7）                                                                   |
| 编码探测                                                                      | —      | 改动 `.mjs` / `.json` / `.md` 均 `bom=False`、纯 LF（`cr=0`）                                          |
| 框架契约对照                                                                  | —      | 状态迁移沿用既有九态与迁移表；幂等键口径对齐 `reliability.md` §2；循环阶段对齐 `autonomous-loop.md` §2 |

- **未重跑全量**：改动不进入 `src/test` 运行时，沿用基线全量口径；编排层定向单测已覆盖新模块全部路径。
- **CLI 试跑**：`improvements --add` 两条候选登记成功；快照双写刷新退出码 0。

## 五、遗留与未决

- **IM-007（candidate · adapter · tech-debt）**：回执幂等次键以交付记录路径指针代替独立工件版本号；若同一 taskId 交付记录路径不变而内容被覆盖，指纹无法区分版本。交接件不可变口径下风险可控；后续补独立 `revision/version`，指纹改以 taskId + version 为准。
- **IM-008（candidate · adapter · gap）**：派发目标角色取 `agentRole` 兜底 `executor`，尚未按 Agent Card 能力声明（skills / tools / availability）匹配路由；当前单 executor 角色无实际影响，AF-013 演练阶段或 P1 接入能力匹配。
- **事件通道替代轮询**：本单落文件事件监听与触发入口；MQ / 总线类事件通道属 P1。
- **executor 侧重复派发查询**：框架 `reliability.md` §2 要求执行方收到重复派发时查索引终态 / 活跃态并回执；本单覆盖编排者派发侧幂等，执行方侧查询归后续批次。
- **后续 P0 依赖链**：AF-011（文件域互斥）依赖 AF-009；AF-013 依赖 AF-010 / AF-011；AF-012、AF-014 独立。

## 六、审计链与回写清单

- [x] 交付记录落固定路径；任务单与交付记录成对归档 `completed/phase2.5/`
- [x] 索引状态迁移追加 `history`，工件指针（任务单 / 交付记录）填全
- [x] 快照与看板 data.js 经 CLI 双写刷新；派发记录经快照只读段投影
- [x] `taskId`（AF-010）贯穿任务单 / 交付记录 / 派发记录 / 台账关联 / commit message
- [x] 并行线产物 `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md` 未混入本单 stage；运行态 `transport/`、`orchestration-store.sqlite`、`tool-audit-log.json` gitignore 不入库
