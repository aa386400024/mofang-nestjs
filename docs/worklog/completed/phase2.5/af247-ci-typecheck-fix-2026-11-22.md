# AF-247 交付记录 · AF-245 CI 全量 typecheck 修复（AF-246 重签发，2026-11-22）

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-247/task-sheet.md`
- 分支：`task/AF-247-af247-ci-typecheck`（stacked 在 AF-245 `83fc2990`）
- 基线：`83fc29905a6fd85a91e60e0123dac3d227eb1c36`
- priorTasks：`AF-245`
- 类型：fix
- 结论：AF-245 PR #94 的 `Lint + Typecheck` 失败已修复；CI 同口径 `tsc --noEmit -p tsconfig.json` 0 error，定向、lint、全量测试全绿。

## 为什么有 AF-246 与 AF-247 两个任务

AF-246 先完成了同样的修复并归档，但任务单漏写 `priorTasks: [AF-245]`。`pr-release create` 扫描 AF-246 分支时，AF-245 的三个提交（登记、实现、归档）落在 AF-246 任务链之外，直接拒绝创建 PR。AF-246 未开 PR、未合并，不能改写已归档任务，因此：

- AF-246 分支与记录保留在原处，作为失败的重签发前身；
- 从 AF-245 HEAD 重新切 `task/AF-247-af247-ci-typecheck`，任务单显式声明 `priorTasks: [AF-245]`；
- 用同一份修复补丁重建 AF-247 提交，保持 AF-245 原提交与证据不动；
- AF-247 PR 承载 AF-245 → AF-247 的任务链，PR #94 关闭。

这不是重复开发：代码改动与 AF-246 相同，AF-247 只补任务链元数据并重新取证。

## 根因

本地 `pnpm typecheck` 跑 `tsc -b tsconfig.check.json`，不覆盖 `bin/` 与 `test/auto-practice/` 的全部类型约束；CI 额外跑 `tsc --noEmit -p tsconfig.json`，暴露三处：

1. `RealismDimension` 从 `visitor-realism-blind-pack.js` 导入，但该文件不导出此类型；真实导出点是 `visitor-realism-rating.js`。
2. 错误导入导致 `score.dimensions[dimension]` 退化为 any。
3. `Record` 索引签名在 `noPropertyAccessFromIndexSignature` 下必须用 `['relational_presence']`，不能点号；而 eslint `dot-notation` 又要求点号，二者冲突需单行豁免。

修导入后又暴露 `Object.fromEntries(...) as Record<...>` 断言不重叠（`{[k:string]: never[]}` → 固定键 Record），改为显式字面量构造函数。

## 变更清单

| 文件 | 变更 |
| --- | --- |
| `bin/visitor-sim-persona-delta.ts` | `RealismDimension` 改从 `visitor-realism-rating.js` 导入；新增 `emptyNumericDimensions()` / `emptyDimensions()` 显式字面量；`computeDimensionDeltas()` 替代 `Object.fromEntries + as` |
| `test/auto-practice/af245-persona-delta.spec.ts` | 维度断言改索引访问，并加一行 `eslint-disable @typescript-eslint/dot-notation` |

审计逻辑、阈值、输出格式、AF-245 结论未改；三轮回放仍是 **改善 7 / 持平 5 / 回落 0**。

## 闸门

| 闸门 | 结果 |
| --- | --- |
| 定向 `pnpm exec vitest run test/auto-practice/af245-persona-delta.spec.ts` | 2/2 passed |
| `pnpm lint` | exit 0，0 error |
| CI 同口径 `pnpm exec tsc --noEmit -p tsconfig.json` | exit 0，0 error |
| `pnpm test` | 253 passed / 1 skipped（文件）；4222 passed / 4 skipped（用例） |
| `git diff --stat HEAD -- src/engine-core` | 空 |

## 发布处置

- PR #94（AF-245）关闭，由 AF-247 stacked PR 取代。
- AF-247 PR 的最终 HEAD 必须包含 AF-247 completed/archived 与 durable receipt，才过 Orchestration Gate。
- AF-246 不合并；其记录只在本地分支，不进入 integrate。后续查询状态面时以 AF-247 为准。

## 偏差与遗留

- 任务号从 AF-246 改为 AF-247，原因如上；修复内容无偏差。
- 本地 `pnpm typecheck` 的覆盖缺口仍在：改 `bin/` 或 `test/` 时必须补跑 CI 同口径 tsc。建议登记一条编排改进，而不是在本任务里改脚本。
