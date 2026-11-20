# AF-036 交付记录：持单动作透传真实释放原因（AF-035-B1）

- 任务单：`docs/worklog/pending/af036-held-reason-passthrough-task-2026-11-17.md`
- 角色：orchestrator
- 交付时间：2026-11-17（本地 +08:00）
- 结论：**passed**。AF-035 演练登记的唯一遗留项关闭。

## 1. 缺陷

AF-035 演练时动作流打出：

```
[动作] delivery-released AF-035（gui-delivery-failed）
[动作] held-for-human AF-035（lease-expired）
```

第二条的 `lease-expired` 是写死的常量，运行态真实 `releaseReason=gui-delivery-failed`。动作流与事件日志是最外层排障面，标签错会把排障引到租约方向。

## 2. 修法

```js
if (getRuntimeEntry(runtimeState, task.taskId)?.heldForHuman === true) {
  const heldEntry = getRuntimeEntry(runtimeState, task.taskId);
  actions.push({ type: 'held-for-human', taskId: task.taskId, reason: heldEntry?.releaseReason ?? 'held-for-human' });
  continue;
}
```

缺省回落 `held-for-human`（而不是别的具体原因），避免运行态缺字段时编造一个看起来确凿的结论。

## 3. 验证

| 项            | 实测                                                                                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单测          | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs --reporter=dot` → exit 0，**169 passed / 0 failed**（1.14s）                        |
| 新增/加强用例 | ① 强化既有租约用例断言 `reason === 'lease-expired'`；② 新增「持单原因随运行态」用例：`releaseReason='gui-delivery-failed'` → 动作 `reason='gui-delivery-failed'` |
| 事件链        | `node scripts/orchestration/cli.mjs events verify` → exit 0，PASS                                                                                                |
| 兼容性        | 状态机分支、配置、CLI 参数均未改动；三条历史终态未触碰                                                                                                           |

## 4. 回写清单

- `scripts/orchestration/scheduler.mjs`（持单动作 reason 透传）
- `scripts/orchestration/__tests__/orchestration.spec.mjs`（+1 用例、1 处断言加强，169 passed）
- 运行态：`task-state-index.json`、`orchestration-state.json`、`orchestration-snapshot.json`、`state/journal.jsonl`、`web/orchestration/data.js`
