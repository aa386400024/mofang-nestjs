# IM-022 派发通道规则覆盖面只读核对 — 交付记录

- **状态**：✅ 核对完成（2026-11-16，纯只读取证，未改规则代码）；IM-022 流转 `candidate → queued → accepted → done`；接线缺口另登记候选 IM-028
- **基线 HEAD**：`21914c9`（AF-017 推送后；本批仅台账与双写产物变更）
- **范围**：只读审读 `scripts/orchestration/dispatch-channel.mjs` 及其测试、CLI 接线；`src/engine-core`、`src/migration`、业务 `src/**/*.ts`、`test/` 零 diff；零新增依赖
- **取证来源**：回执 `docs/worklog/pending/archive/relay-response-af013-drill-20261116.md`（DR-001）D-2 / D-5 / D-7；`dispatch-channel.mjs`；`cli.mjs`；`handover-contract.mjs`；`__tests__/orchestration.spec.mjs`

---

## 一、背景

回执 DR-001 当时记录：工作区存在未纳入版本控制的 `scripts/orchestration/dispatch-channel.mjs`，该单未审读、不作口径结论；若其已实现重试逻辑，D-2 / D-5 / D-7 可能已有代码侧对应，需另开只读核对单确认。本记录即该核对单：逐条核对规则层是否已覆盖三条差异，并区分「规则已备」与「运行时接线未激活」。

## 二、核对结论：规则层已对应，运行时接线未激活

### 2.1 D-2 重试形态与退避 —— 规则层已落地

| 回执原缺口                                                     | 代码对应                                                                                                                                                                                                                      | 落点                                                 |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 通道写死「重试一次」、无退避；框架要求指数退避且限次未定义数值 | `BACKOFF_MS=[0,500,1000]` 指数退避序列 + `nextBackoff(attemptIndex)`（纯数据查询，不 sleep）；`MAX_TOTAL_ATTEMPTS=3` 任务级总尝试预算；局部 `MAX_START_RETRIES=1` / `MAX_SEND_RETRIES=1` 受总预算封顶；降级路径切换计一次尝试 | dispatch-channel.mjs:30/33/39/45/97；spec 1265、1285 |

### 2.2 D-5 失败终态出口双轨 —— 规则层已分流

不可恢复类别短路直接 `failed`、不进重试 / 降级链；可恢复故障在任务级预算内降级重试，耗尽转 `held-ready` 升级 Human。两条出口在 `resolveDispatchDecision` 内按 cause 类别与预算明确分流（spec 1258、1274）。

**层级口径**：`held-ready` / `human-escalated` 属审计结果枚举 `DISPATCH_RESULTS`，不是任务状态枚举 `TASK_STATUSES`（后者为 backlog / ready / submitted / working / input-required / auth-required / completed / failed / canceled / rejected）。接线时需把审计结果映射回任务 status。

### 2.3 D-7 确定性缺陷终止规则 —— 规则层已落地

`IRRECOVERABLE_CAUSES` 含 `deterministic-defect`；`isIrrecoverable` 短路 `fail-terminal`，不进入重试 / 降级链（spec 1256–1258）；定性三分法 `FAILURE_CLASSIFICATIONS=['deterministic','flaky','legacy-debt']` 与审计 `classification` 字段校验已备。

### 2.4 统一残留缺口：接线层未激活

`resolveDispatchDecision`、`buildDispatchAudit`、`isIrrecoverable`、`nextBackoff`、`MAX_TOTAL_ATTEMPTS` **仅被单测引用**；CLI 只接 `canDispatch`（队列互斥，cli.mjs:399），`channel` 命令为只读规则展示。退避等待、审计落库、终态写回任务状态均未在运行时接线（真实桌面 IO 归 relay 层，当前未接入）。与 AF-015 / AF-016 adapter 纯函数批同阶段口径：规则 + 单测先备，运行时接线留后续批次。

### 2.5 连带覆盖的其他回执项（规则层已备、接线未激活）

| 回执项                       | 规则层对应                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| D-1 通道层失败定性三分法载体 | `classification` 字段 + 枚举校验（buildDispatchAudit）                                            |
| D-3 每次重试逐次留痕载体     | `attempts[]` 结构 + `validateAttemptEntry`（会话路径 / 定位层 / 原因 / 退避时长 / 结果 / 时间戳） |
| D-4 统一重试预算             | `MAX_TOTAL_ATTEMPTS=3` 任务级总预算，局部重试不突破                                               |
| D-11 备忘字段不自洽          | 纯文档问题，与代码无关（对应 IM-021）                                                             |

## 三、台账变更

| 台账   | 流转 / 登记                                                              | 说明                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IM-022 | `candidate → queued → accepted → done`                                   | resolutionNote 记录：规则层已对应 D-2 / D-5 / D-7 并有单测覆盖；决策 / 审计函数运行时接线未激活；接线项另登记 IM-028。无关联 AF 任务单，`linkedTaskId=null`          |
| IM-028 | 新增 `candidate`（implementation / gap / adapter，relatedTaskId DR-001） | 派发决策链运行时接线：CLI/scheduler 调 `resolveDispatchDecision` 与 `buildDispatchAudit`，审计结果映射回任务状态机，退避等待交 relay 层；依赖真实桌面通道激活，排 P2 |

## 四、闸门证据

| 命令 / 校验                                                                   | 结果                                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 1 file passed；**116 passed**；Duration 5.62s               |
| `node scripts/orchestration/cli.mjs validate`                                 | **5/5 PASS**（状态索引、工具契约、三角色 Agent Card）       |
| `improvement-log.json` / `orchestration-snapshot.json`                        | `Test-Json` **OK**                                          |
| 业务源码隔离                                                                  | `git diff --stat HEAD -- src test` 为空；本批无规则代码改动 |

> 本批无 `scripts/*.mjs` 规则改动，未重跑 `pnpm lint:fast`（沿用 AF-017 0 warning / 0 error 基线）；未跑全量 typecheck（台账 JSON / 双写产物不进入 `src/test` 运行时，同 AF-015~017 口径）。

## 五、遗留与未决

- **IM-028（P2，依赖桌面通道激活）**：决策 / 审计函数运行时接线；审计结果枚举到任务状态机的映射；退避等待由 relay 层执行。
- **D-5 权威出口语义**：规则层已按 cause 分流，但「通道失败终态出口以 ready 还是 failed 为准」的框架级口径仍属开放问题 IM-023，待框架 reliability.md 定调后回填。
- **D-11 备忘字段自洽**：纯文档修正，对应 IM-021，不在本代码核对范围。
- IM-022 历史标题保留登记时原文（未纳入版本控制 / 未审读），现状以 resolutionNote 为准；不回改历史标题。
