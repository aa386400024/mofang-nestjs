# AF-077 pr-release 本地合并门口径修正交付记录

- 任务单：`docs/worklog/pending/af077-pr-release-conditional-task-2026-11-18.md`
- 任务 ID：`AF-077`
- 分支：`task/AF-075-framework-closeout-scope`（stacked 在 AF-076 提交 `e381112` 之后）
- 日期：2026-11-18
- 结论：`passed`

## 1. 背景与根因

AF-076 已把 CI `Orchestration Gate` 改成「可合并 durable 回执」，PR #24 的 13 项检查已全绿。但本地 `pr-release.mjs merge` 仍调用 `hasPassedDurableReceipt`，硬编码只接受 `verdict === 'passed'`，对 AF-075 的 `conditional-pass` 直接报「没有 passed 的 durable 回执」。

根因是同一语义存在第二份实现：CI 门与本地合并门各写一套回执判定。AF-076 只修了 CI 门，本地工具仍拒绝合并，导致「CI 放行、本地不让合」的割裂。

## 2. 修改

- `scripts/orchestration/pr-release.mjs`
  - 从 `ci-task-gate.mjs` 引入 `mergeableDurableReceipts`，删除本地自写的 `verdict === 'passed'` 判定；
  - `hasPassedDurableReceipt` 读取完整字段：`verdict / scopeCheck / finalStatus / manualReviewList / backlogItems`；
  - 合并错误文案改为「没有可合并的 durable 回执（passed，或已登记 backlog 且无人工复核项的 conditional-pass）」。
- `scripts/orchestration/__tests__/orchestration.spec.mjs`
  - 新增 2 个用例：conditional-pass + 已登记 backlog 且无人工复核项 → 放行；有 `manualReviewList` → 拒绝。
  - 用临时目录构造 durable 回执，测试不写仓内状态。

未改 `src/`、`test/` 业务代码；未放宽 scope 越界、任务单缺失、status 非 completed、人工复核项这些硬红线。

## 3. gateResults（闸门结果）

| 命令 | 退出码 | 真实结果 |
| --- | --- | --- |
| `corepack pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0 | 1 file / **241 tests passed / 0 failed**，566ms |
| `corepack pnpm lint` | 0 | 0 error / 0 warning；scripts 段覆盖生效；仅 node engine WARN（v22.23.2 vs >=26） |
| `node scripts/orchestration/cli.mjs validate` | 0 | 24 项 PASS（状态索引 / 工具契约 / 协议视图 / 交付包 / Agent Card / AF-070–AF-077 回执与运行态任务单 / 事件日志 schema+哈希链 / 索引投影） |
| `node scripts/orchestration/cli.mjs events verify` | 0 | 事件日志 **324 条**；schema + 哈希链 + 索引投影一致 |

## 4. scopeCheck（范围核对）

`in-scope`。改动仅 `scripts/orchestration/pr-release.mjs`、编排单测、任务单与本交付记录。状态面生成物按 V7 豁免。未触碰业务 `src/`、数据库、Redis、LLM 批次。

## 5. contractChecks（契约核对）

- `taskId` 贯穿任务单、交付记录、回执：`AF-077`。
- 状态写只经 CLI：`task register` → `task promote` → `run-once` → 回执摄入 / 归档。
- 本地合并门与 CI 门共用 `mergeableDurableReceipts`，不再有两套判定。
- conditional-pass 的可合并条件与 AF-076 完全一致：`scope=in-scope`、`finalStatus=completed`、`manualReviewList` 为空、每条 backlog 有编号。
- 未新增框架 tag/release；L4 冻结动作仍未执行。

## 6. backlogItems（遗留登记）

无新增。AF-075 的 `IM-053`（连续长跑 / stale-ack 实战）仍在改进台账跟踪，本单不代签。

## 7. deviationTable（偏差说明）

| 项 | 任务单原方案 | 实际实现 | 原因 |
| --- | --- | --- | --- |
| 复用范围 | 只换判定函数 | 同时补齐回执五字段读取 | 不补齐就判不出人工复核项与遗留编号 |
| 测试构造 | 直接构造内存回执 | 临时目录落盘 durable 回执再调用 | 覆盖真实 `readdirSync` / JSON 解析路径 |
| 错误文案 | 保留旧文案 | 改为两种合法形态并列 | 避免运维误判为「必须 passed」 |

## 8. reviewVerdict（验收结论）

`passed`。

理由：单测 241 项全绿，lint 0 error / 0 warning；本地合并门与 CI 门共用同一判定，conditional-pass 仍受人工复核项与遗留编号约束；未改业务代码，无新增遗留。
