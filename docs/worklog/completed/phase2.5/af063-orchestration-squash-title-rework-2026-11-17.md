# AF-063 · 编排门 squash 标题去重返修

> 交付日期：2026-11-17
> 任务单：[af063-orchestration-squash-title-rework-task-2026-11-17.md](../../pending/af063-orchestration-squash-title-rework-task-2026-11-17.md)
> 基线：`29a855b5122c86b4754b9d245f75babceb92de83`（AF-061 squash 合并后的 integrate HEAD）
> 分支：`task/AF-063-orchestration-squash-title-rework`

## 1. 结论

squash 标题生成器已修好，并通过机读验收所需的文档链路与六组字段标记。AF-062 的失败点是交付记录链接层级与机读标记缺失，不是代码；AF-063 只承接返修，不把 AF-062 的 rejected 提交带进 PR。

## 2. 背景与根因

AF-061 的 PR #15 在 13 项 required checks 全绿后 squash 合并为 `29a855b5122c86b4754b9d245f75babceb92de83`。合并后 `integrate` 的 push 版 `Orchestration Gate` 失败：

```text
[ORCH-CI-GATE] FAIL 29a855b5122 reason=ambiguous-task-id
subject=chore(orchestration): AF-061 Phase2.5 出口条件取证重定（AF-060 验收断链返修）
  - 提交标题含多个任务编号：AF-061、AF-060
```

根因是 `buildSquashCommitMessage()` 直接把任务单 `title` 拼到主任务号后面。AF-061 的任务单标题带 `AF-060` 引用，生成 PR 标题与 squash 提交标题时两个编号同时出现；`ci-task-gate.mjs` 按“一个提交只能有一个任务号”判 `ambiguous-task-id`。

AF-062 已实现生成侧修复并跑绿 233 项编排单测，但 `run-once` 机读验收判 `rejected`：

```text
断链：../pending/af062-orchestration-squash-title-task-2026-11-17.md
交付记录未出现字段标记：gateResults
交付记录未出现字段标记：scopeCheck
交付记录未出现字段标记：contractChecks
交付记录未出现字段标记：backlogItems
交付记录未出现字段标记：deviationTable
交付记录未出现字段标记：reviewVerdict
```

交付记录位于 `docs/worklog/completed/phase2.5/`，`../pending/` 会解析到不存在的 `completed/pending/`；正确路径是 `../../pending/`。六组机读标记也漏写。AF-062 的代码与单测没有失败。

## 3. 修复

`scripts/orchestration/branch-workflow.mjs`：

- 新增 `stripTaskIdsFromSubject(title)`：
  - 先删除含 `AF-/WP-` 编号的括号段（全角 `（）` 与半角 `()` 都覆盖）；
  - 再删除标题中剩余的 `AF-/WP-` 编号；
  - 清理空括号与多余空白；
  - 标题被清空时回退为 `squash merge into integrate`。
- `buildSquashCommitMessage()` 改为 `taskId + stripTaskIdsFromSubject(title)`，主任务号只由 `taskId` 提供。

实测输出：

```json
{ "message": "chore(orchestration): AF-061 Phase2.5 出口条件取证重定", "taskId": "AF-061" }
```

外部引用仍保留在 PR 正文、任务单与交付记录，不丢失上下文。

## 4. 回归用例

`scripts/orchestration/__tests__/orchestration.spec.mjs` 新增 `squash 标题剥离外部任务号，只保留主任务号`，覆盖：

- 全角括号引用：`Phase2.5 出口条件取证重定（AF-060 验收断链返修）` → 只解析出 `AF-061`；
- 半角括号引用：`出口取证 (AF-060 rework)` → 只解析出 `AF-061`；
- 裸编号引用：`修复 AF-060 的 gate` → 只解析出 `AF-062`。

## 5. 闸门

| 闸门     | 命令                                                                          | 结果                                      |
| -------- | ----------------------------------------------------------------------------- | ----------------------------------------- |
| 编排单测 | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | exit 0；1 file / 233 tests passed / 586ms |
| 类型检查 | `pnpm typecheck`                                                              | exit 0；0 error                           |
| Lint     | `pnpm lint`                                                                   | exit 0；0 error / 0 warning（带缓存）     |
| 内核边界 | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                      | exit 0；1 file / 12 tests passed / 865ms  |
| 状态链   | `node scripts/orchestration/cli.mjs events verify`                            | 回执摄入后复跑，见 §8                     |

## 6. 范围与隔离

- 只改编排生成器、单测、任务单/交付记录与编排状态面；不改业务源码、不改 `engine-core`、不跑 LLM 批次、不动数据库与 `.env`。
- 未提交 `admin-dashboard/pnpm-lock.yaml`、`data/batch-reports/**`、`web/orchestration/data.js`、`docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md` 等并行产物。
- AF-062 的 `rejected` 终态、原始提交 `94fd133` 与 durable 回执保持原样；AF-063 从 `integrate` 干净切出，只提交本单改动。

## 7. 合并后闭环

- 本记录写于 PR 合并前；AF-063 合并后需读取新 `integrate` HEAD 的 `Orchestration Gate`，确认 push 版门为 `success`。
- `29a855b` 的失败 check 保留为历史；AF-063 合并后的新 HEAD 必须出现新的 `Orchestration Gate=success`，且提交标题只含 `AF-063`。

## 8. 机读回执字段（验收机读标记）

- `gateResults`: 编排单测 233 passed / 0 failed；typecheck exit 0 / 0 error；lint exit 0 / 0 error / 0 warning；boundary 12 passed / 0 failed；preflight PASS。
- `scopeCheck`: `in-scope`；只改编排生成器、单测、任务单/交付记录与编排状态面，无业务源码、数据、环境改动。
- `contractChecks`: taskId / state-write / index-schema / event-chain 四项通过；任务单 gates 阈值齐全。
- `backlogItems`: 无新增；AF-061 合并后 push 门失败由本单修复，不另立遗留。
- `deviationTable`: 见 §6 三项：AF-062 机读 rejected、AF-062 提交不进本 PR、标题引用只留正文。
- `reviewVerdict`: `passed`；理由见 §9。

## 9. 结论

- `finalStatus`: `completed`
- `reviewVerdict`: `passed`
- `verdictRationale`: 交付记录链接已修正为 `../../pending/`，六组机读标记齐全；生成器只输出主任务号，回归用例覆盖全角/半角/裸编号引用；编排单测 233 项、typecheck、lint、boundary、preflight 全绿，未跳钩、未改业务源码；AF-062 归档历史保持原样。

## 10. 机读验收

- `run-once`：`receipt-ingested AF-063`、`archive-completed AF-063`。
- `autoVerdict`：`passed`；`manualReview=[]`。
- V4：交付记录相对链接 `missing=[]`；六组机读标记齐全。
- 归档：`docs/worklog/pending/archive/AF-063-receipt-RC-AF-063-1.json`，6785 B。
- 事件链：`events verify` PASS，254 条，schema `urn:agent-collaboration-framework:schema:state-event:1.0.0`。
