# AF-117 交付记录 · AF-116 CI 全量类型检查与 lint 修复

- 任务：AF-117（fix，dependsOn AF-116）
- 分支：`task/AF-117-ci-fix`（从 AF-116 HEAD `c5da9ab` 切出的 stacked 分支）
- 范围：`bin/ai-double-blind.ts`、`test/auto-practice/ai-double-blind.spec.ts`
- 目标：只修 CI 暴露的严格类型与 lint 问题，不改评分/仲裁语义，不改 AF-116 已归档证据。

## 失败根因

PR #44 的 CI 任务 `Lint + Typecheck` 使用：

```
pnpm exec tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo
```

本机 `pnpm typecheck` 走 `tsconfig.check.json`，未覆盖 `bin/` 与 `test/` 的全部严格检查。CI 抓到 18 处错误，集中在：

- `bin/ai-double-blind.ts` 未使用导入、index signature 属性访问、只读数组赋值、泛型结果数组类型；
- `test/auto-practice/ai-double-blind.spec.ts` 的 `rater()` 辅助函数缺少默认参数。

## 修复内容

| 文件 | 修复 |
| --- | --- |
| `bin/ai-double-blind.ts` | 删除未使用导入；`row['packet_id']` / `finalRow['packet_id']` 改括号访问；`disputedDimensions` 用 `LongSessionDimension` 类型守卫过滤；`mapLimit` 改为 `const results: R[]`；`ArbitrationResult.decisions` 改 `readonly` |
| `test/auto-practice/ai-double-blind.spec.ts` | `rater()` 的 `values` 参数加默认 `{}`，覆盖无参数调用 |

未改动评分、仲裁、提示词、阈值或数据路径。

## 闸门证据（本机，2026-11-19）

| 类型 | 命令 | 结果 |
| --- | --- | --- |
| CI 全量类型检查 | `pnpm exec tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo` | exit 0；0 error |
| lint | `pnpm lint` | exit 0；0 error / 0 warning |
| 定向测试 | `pnpm exec vitest run test/auto-practice/ai-double-blind.spec.ts test/engine-core/boundary.spec.ts` | exit 0；2 files / 26 tests passed |
| 空白检查 | `git diff --check` | exit 0 |

## 偏差

- `task register` 首次因 `successCriteria` 非数组、`gates` 缺 `threshold` 被 schema 拒绝，补字段后登记成功；属任务单格式修正，不改实现。
- 因 AF-116 已归档，按框架从 AF-116 HEAD 切 stacked 分支，未继续写 AF-116 任务分支，也未改写其回执。

## scopeCheck

`in-scope`。本任务只改 `bin/ai-double-blind.ts`、`test/auto-practice/ai-double-blind.spec.ts` 与本交付记录；未改 engine-core、评分/仲裁语义、AF-116 已归档证据。

## contractChecks

- taskId：pass，AF-117 任务单、索引、回执一致。
- state-write：pass，register/run-once 经 CLI。
- index-schema：pass，task-state-index 由 CLI 写入。
- event-chain：pass，events verify 通过。

## backlogItems

- OI-AF117-01：PR #44 需在 stacked PR 合并后关闭并标记 supersede。

## deviationTable

| 偏差 | 任务单 | 实际 | 处置 |
| --- | --- | --- | --- |
| 分支创建 | 从 integrate 切出 | AF-116 未合并且已归档，从 c5da9ab 切 stacked | 回执登记；PR base 仍为 integrate |
| 任务单 schema | 一次登记通过 | 首次缺 `threshold` / `successCriteria` 非数组被拒 | 补齐后重新登记 |

## reviewVerdict

`passed`。CI 同口径全量 tsc 0 error、lint 0 error、定向 26 测试通过、`git diff --check` 通过；修复只触及 bin/test 类型与 lint，不改评分/仲裁语义与 AF-116 归档证据。

