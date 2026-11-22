# AF-076 Orchestration Gate 口径修正交付记录

- 任务单：`docs/worklog/pending/af076-gate-conditional-merge-task-2026-11-18.md`
- 任务 ID：`AF-076`
- 分支：`task/AF-075-framework-closeout-scope`（stacked 在 AF-075 提交 `4ef9ae8` 之后）
- 日期：2026-11-18
- 结论：`passed`

## 1. 背景与根因

PR #24 的 `Orchestration Gate` 对 AF-075 同时报两个失败：

1. `no-active-task`：AF-075 已在当前 HEAD 归档为 `completed`，但 `ci-task-gate.mjs` 的 squash 全生命周期判定只在 durable 回执为 `passed` 时才承认归档迁移；AF-075 是 `conditional-pass`，于是父提交无任务、当前归档又不被借用作在办快照。
2. `passed-durable-receipt-missing`：合并门硬编码只接受 `reviewVerdict=passed`，而验收器允许 `conditional-pass`。验收器认为可交付、合并门一律拒绝，两套口径互相矛盾。

根因不是代码缺陷，是门禁语义单点过严：把「有条件通过」当成「未验收」，也没有把「已登记遗留」纳入可合并条件。

## 2. 修改

- `scripts/orchestration/ci-task-gate.mjs`
  - 新增 `mergeableDurableReceipts`：
    - `passed`：`scopeCheck=in-scope` + `finalStatus=completed`；
    - `conditional-pass`：在 passed 条件上，`manualReviewList` 必须为空，且 `backlogItems` 每条都有非空编号；
    - 其他 verdict 一律不可合并。
  - `squashLifecycle` 与 `evaluateAcceptanceSnapshot` 统一改用该判定，修复 archived completed 识别。
  - `readAcceptanceReceiptsAt` 补读 `manualReviewList` / `backlogItems`，让门禁能核验遗留是否登记。
  - 拒绝原因文案改为「缺少可合并 durable 回执」，并写清两种合法形态。
- `scripts/orchestration/__tests__/orchestration.spec.mjs`
  - 新增 3 个用例：conditional-pass + 已登记 backlog 允许合并；有 `manualReviewList` 时拒绝；backlog 缺编号时拒绝。
  - 原「非 passed 一律拒绝」用例替换为新语义，避免测试固化了错误口径。
- `docs/team/agent-orchestration/acceptance-checklist.md`：补「合并门细则」，明确 conditional-pass 的四个可合并条件。
- `docs/team/agent-orchestration/README.md`：§1 服务端硬门、§6 流程第 5 步、§6 远端门表统一改为「可合并 durable 回执」，不再写死 passed。

未改 `src/`、`test/` 业务代码；未放宽 scope 越界、任务单缺失、status 非 completed 这些硬红线。

## 3. gateResults（闸门结果）

| 命令 | 退出码 | 真实结果 |
| --- | --- | --- |
| `corepack pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0 | 1 file / **239 tests passed / 0 failed**，583ms |
| `corepack pnpm lint` | 0 | 0 error / 0 warning；scripts 段覆盖生效；仅 node engine WARN（v22.23.2 vs >=26） |
| `node scripts/orchestration/cli.mjs validate` | 0 | 22 项 PASS（状态索引 / 工具契约 / 协议视图 / 交付包 / Agent Card / AF-070–AF-076 回执与运行态任务单 / 事件日志 schema+哈希链 / 索引投影） |
| `node scripts/orchestration/cli.mjs events verify` | 0 | 事件日志 **319 条**；schema + 哈希链 + 索引投影一致 |
| `corepack pnpm exec vitest run test/engine-core/boundary.spec.ts` | 0 | 1 file / **12 tests passed / 0 failed**，850ms（AF-076 未改 engine-core，沿用 AF-075 已跑结果） |

## 4. scopeCheck（范围核对）

`in-scope`。改动仅 `scripts/orchestration/ci-task-gate.mjs`、编排单测、`docs/team/agent-orchestration/` 两份适配层文档与任务/交付记录。状态面生成物按 V7 豁免。未触碰业务 `src/`、数据库、Redis、LLM 批次。

## 5. contractChecks（契约核对）

- `taskId` 贯穿任务单、交付记录、回执：`AF-076`。
- 状态写只经 CLI：`task register` → `task promote` → `run-once` → 回执摄入 / 归档。
- 合并门口径与验收器口径对齐：`conditional-pass` 不再被无条件拒绝，但人工复核项和未编号遗留仍是硬阻断。
- squash 全生命周期使用同一套可合并回执判定，AF-075 的 archived completed 可在父提交无任务时被识别。
- 未新增框架 tag/release；L4 冻结动作仍未执行。

## 6. backlogItems（遗留登记）

无新增。AF-075 的 `IM-053`（连续长跑 / stale-ack 实战）继续由改进台账跟踪；本单不重复登记，也不把它当作已验证。

## 7. deviationTable（偏差说明）

| 项 | 任务单原方案 | 实际实现 | 原因 |
| --- | --- | --- | --- |
| 合并门判定 | 只改 `conditional-pass` 放行 | 同时抽成 `mergeableDurableReceipts`，让 squash 生命周期与 PR 验收共用 | 避免两处判定再次漂移 |
| 遗留约束 | 只看 backlog 是否存在 | 要求每条都有非空编号 | 防止用空对象伪造「已登记」 |
| 测试 | 只加通过用例 | 增加人工复核阻断与缺编号阻断两侧 | 证明没有降低总闸门强度 |

## 8. reviewVerdict（验收结论）

`passed`。

理由：单测 239 项全绿，lint 0 error / 0 warning；门禁只放宽「已登记且无人工复核」的 conditional-pass，scope 越界、人工复核、缺编号遗留仍拒绝；未改业务代码，无新增遗留。
