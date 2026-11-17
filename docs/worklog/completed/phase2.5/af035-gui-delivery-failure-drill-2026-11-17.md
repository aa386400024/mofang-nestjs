# AF-035 交付记录：GUI 投递降级回收实弹演练（AF-024-R2 关闭）

- 任务单：`docs/worklog/pending/af035-gui-delivery-failure-drill-task-2026-11-17.md`
- 角色：executor（只有执行代理角色才走 `gui-relay`，这是被测对象决定的）
- 交付时间：2026-11-17（本地 +08:00）
- 结论：**passed**。降级回收路径从「只有单测」变成「真实跑过一遍并留证」。

## 1. 为什么必须用真实任务演练

`releaseFailedDeliveries` 与 `task resume` 的正确性取决于三件运行时事实：运行态条目是否保留上轮 `dispatch`、`delivery.lastAttempt` 是否落盘、`resolveChannelSelection` 是否读得到上轮失败。替身测试可以覆盖逻辑分支，但覆盖不了「状态文件被谁写、写了什么」。本次演练全程用真实 CLI 与真实运行态，六步输出逐条留证。

## 2. 六步实测

### 步骤 1-2：登记 / 提级 / 领单（走 GUI 通道）

```
已登记任务 AF-035（backlog）→ docs/worklog/pending/af035-gui-delivery-failure-drill-task-2026-11-17.md
已提级任务 AF-035：status=ready，promotedAt=2026-11-17T03:14:14.866Z
[动作] claim AF-035
[动作] dispatch-decision AF-035（configured-channel）
[动作] dispatch AF-035（gui-relay）
```

`channel state` 输出：`channel=gui-relay`、`delivery.state=pending`、`briefRef=transport/briefs/AF-035.brief.md`、`stalled=false`。这一步证明 AF-034 的配置归一已生效——决策的 `configuredChannel=gui-relay` 不再是 `file`。

### 步骤 3：模拟桌面 relay 失败并降级

```
node scripts/orchestration/cli.mjs channel fallback --taskId AF-035 \
  --reason "演练：模拟桌面 relay 会话失焦，粘贴未落输入框" \
  --classification flaky --cause flaky --send-retries 1 --attempt-count 2
已降级：AF-035；channel=gui-file-fallback；原因=…；定性=flaky
现场事实：cause=flaky loginGate=false attemptCount=2
```

`channel state` 输出：`channel=gui-file-fallback`、`delivery.state=failed`、`failureReason` 与 `classification=flaky` 落盘、`lastAttempt`（含 `state=pending` 的上轮痕迹）、`stalled=true`。

### 步骤 4：回收 → 持单

```
[动作] delivery-released AF-035（gui-delivery-failed）
```

运行态：`heldForHuman=true`、`releaseReason=gui-delivery-failed`、`dispatchDecisionResult={action:'human-escalate', reason:'执行代理进程启动失败达局部重试上限（1）…'}`。

现场事实 `cause=flaky` 不会被判成不可恢复（`fail-terminal` 只对四类不可恢复类别生效），所以走到「保持 ready + 升级 Human」——这正是 reliability.md §4.1 的口径。

### 步骤 5：恢复持单

```
已恢复任务 AF-035：heldForHuman=false，releaseReason=manual-resume
```

### 步骤 6：重派走降级通道

```
[动作] claim AF-035
[动作] dispatch-decision AF-035（delivery-fallback-after-failure）
[动作] dispatch AF-035（gui-file-fallback，attempt=2）
```

运行态决策：`{channel:'gui-file-fallback', reason:'delivery-fallback-after-failure', attempt:2, configuredChannel:'gui-relay', previousDeliveryState:'failed'}`。**关键点**：任务没有被再次塞回 `gui-relay` 撞同一堵墙，`attempt` 递增到 2，上轮失败痕迹保留。

## 3. 闸门

| 字段             | 实测                                                                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gateResults`    | `channel state --taskId AF-035` → exit 0，降级后 `channel=gui-file-fallback` 且 `delivery.state=failed`；`node scripts/orchestration/cli.mjs events verify` → exit 0，事件链 PASS（129 条）；`ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate` → exit 0，27 PASS / 0 FAIL |
| `scopeCheck`     | `in-scope`：只写 `docs/worklog/` 本单任务单、演练记录与回执；未改代码、未改配置                                                                                                                                                                                                |
| `contractChecks` | taskId 一致 ✅；演练未手改索引/运行态（全部经 CLI）✅；索引 schema PASS ✅；事件链 PASS ✅                                                                                                                                                                                     |
| `backlogItems`   | 1 条：回收动作标签 `held-for-human（lease-expired）` 与真实原因 `gui-delivery-failed` 不一致，属文案级缺陷，由后续小单修（见 §5）                                                                                                                                              |
| `deviationTable` | 1 条：AF-033 同题材演练因配置丢段阻塞并取消，本单重做（见 §4）                                                                                                                                                                                                                 |
| `reviewVerdict`  | `passed`                                                                                                                                                                                                                                                                       |

## 4. 过程事故与处置

| 事故                                                                             | 处置                                                                                                                   |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| AF-033 首次演练领单落到 `file` 通道，`channel fallback` 报「通道不是 gui-relay」 | 追根因到 `validateConfig` 丢 `dispatch` 段，AF-033 取消归档（`canceled`，原因写明），由 AF-034 修配置归一，AF-035 重做 |
| 演练前两次 `events rechain` 切点取错（取被改事件的后一条）                       | 切点必须是被改写的那条事件本身；`verify` 报 hash 不匹配即为信号，重算后 129 条 PASS                                    |

## 5. 遗留

- `claimReadyTasks` 的 `held-for-human` 动作把 `reason` 固定写成 `lease-expired`，与运行态真实的 `gui-delivery-failed` / `gui-delivery-budget-exhausted` 不一致，属可观测性缺陷（不影响状态机），已登记，由 AF-036 收口。
- 演练默认 `fallbackToFile=true`；若把兜底关掉（`fallbackToFile=false`），重派会回到 `gui-relay` 重试，该分支由单测覆盖（`fallback-disabled-retry`）。

## 6. 回写清单

- `docs/worklog/completed/phase2.5/af035-gui-delivery-failure-drill-2026-11-17.md`（本记录）
- `docs/team/agent-orchestration/transport/receipts/AF-035.json`
- 运行态：`task-state-index.json`、`orchestration-state.json`、`orchestration-snapshot.json`、`state/journal.jsonl`、`web/orchestration/data.js`
- 演练副产物：`transport/briefs/AF-035.brief.md`（运行态，不入库）
