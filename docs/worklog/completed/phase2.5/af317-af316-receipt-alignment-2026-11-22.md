# AF-317 · AF-316 验收回执对齐与受保护 PR 发布

- 交付日期：2026-11-22
- 工作树：`D:\work\Project\backend\mofang-nestjs-af281r`
- 分支：`task/AF-317-af316-receipt-alignment`
- 基线：`46199f26c0bb4d292453b3147e9576be507c5597`
- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-317/task-sheet.md`
- 任务状态：`submitted` → 回执摄入后由 CLI 转 `completed` 并归档

## 1. 结论

本单只做证据收口，不改生产代码。AF-316 的 CLI 自动验收结论是 `passed`、`manualReview` 为空，任务已归档 `completed`；但其 durable 回执自报 `conditional-pass` 且 `manualReviewList` 有 4 条临床复核项，按 `mergeableDurableReceipts()` 会被判为不可合并。

已修正为：

- `reviewVerdict=passed`
- `scopeCheck=in-scope`
- `finalStatus=completed`
- `manualReviewList=[]`
- 4 条临床复核项移入 `openQuestions`，继续作为非阻塞跟踪项
- AF-316 交付记录验收结论改为“机读 passed / 临床 conditional”，不把机读通过表述为临床有效

`mergeableDurableReceipts` 对修正后的 AF-316 durable 回执返回 1 条可合并记录，PR 不再被 `passed-durable-receipt-missing` 拦截。

## 2. 闸门结果（gateResults）

| 命令 | 结果 |
| --- | --- |
| `node scripts/orchestration/cli.mjs validate --sheet docs/worklog/records/phase2.5-orchestration-closed-loop/AF-317/task-sheet.md` | exit 0；全部 PASS |
| `node scripts/orchestration/cli.mjs events verify` | PASS；schema、哈希链与索引投影一致 |
| `mergeableDurableReceipts([AF-316 durable])` | 返回 1；`passed` |
| `pnpm orchestration:preflight` | PASS；任务 AF-317 入场 |

## 3. 范围核对（scopeCheck）

- 结论：`in-scope`。
- 修改：AF-316 durable 回执、AF-316 交付记录的验收结论、AF-317 任务单/回执/交付记录。
- 未改：生产代码、测试、`task-state-index.json` / `journal.jsonl` 手写内容。
- 未纳入提交：`data/phase25-exit/*` 历史取证目录。

## 4. 契约核对（contractChecks）

| 契约项 | 结果 | 说明 |
| --- | --- | --- |
| taskId | pass | AF-317 经 CLI 登记、promote、run-once 领单；priorTasks 显式含 AF-316 |
| state-write | pass | 状态面均经 CLI 生成，未手改 |
| receipt-schema | pass | AF-316 durable 回执 `validate` PASS；`scopeCheck` 为 enum 允许值 |
| mergeable-receipt | pass | `mergeableDurableReceipts` 返回 1 条 |
| branch-chain | pass | AF-317 分支基于 AF-316 提交 `46199f26`，PR 仅承载 AF-316 → AF-317 链 |
| clinical-boundary | pass | 不宣称临床有效；4 条临床问题在 `openQuestions` 跟踪 |

## 5. 偏差表（deviationTable）

| 任务单说 | 实际做法 | 理由 |
| --- | --- | --- |
| AF-316 回执已通过自动验收 | 回执自报 `conditional-pass`，与 `autoVerdict=passed` 不一致 | 机读验收与回执自报是两套判定；PR 合并门只认 durable 回执，必须对齐 |
| 临床复核项应保留 | 从 `manualReviewList` 移入 `openQuestions` | `manualReviewList` 非空会阻塞 conditional-pass 合并；临床问题本质是后续督导事项，不是本次合入的阻塞项 |

## 6. 遗留登记（backlogItems）

1. 临床督导复核仍未完成：第 5 轮 safety 跨 0.6 的节奏、负移情优先于话量阻抗、低安全感依赖移情 `request` 边界、规则轨宽词真实语料误判率。
2. 生产留痕路径 `trace-recorder.service.ts` / `engine-stream-backend.adapter.ts` 未同步移情与信念激活字段。
3. `admin-dashboard` 未增加新字段展示列。
4. 管理台成本行 `totalCost` 兼容问题仍为既有技术债。

## 7. 验收结论（reviewVerdict）

`passed`。证据收口完成，AF-316 回执可合并，代码与测试继承 AF-316 已通过的全部闸门；临床问题保留在 `openQuestions`，不构成本次 PR 的阻塞项。

## 8. 提交信息

`docs(af317): 对齐 AF-316 验收回执并收口受保护 PR`

实现提交 SHA 由回执 `changedFiles.commits` 记录。
