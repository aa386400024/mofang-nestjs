# AF-228 · AF-227 PR #80 CI 类型检查修复

> 任务：修复 AF-227 跨模型报告评分员 thinking 字面量在 `tsconfig.json` 下被宽化为 string 的问题
> 日期：2026-11-21
> 状态：已完成
> 分支：`task/AF-228-ci-typecheck-fix`（从 AF-227 HEAD `dd44f92e` stacked）
> 关联：AF-227 / PR #80（superseded）

## 根因

AF-227 的 PR #80 13 项检查中 `Lint + Typecheck` 失败，本地 `pnpm typecheck` 却通过。差异在检查入口：

- 本地 `pnpm typecheck` 跑 `tsc -b tsconfig.check.json`；
- CI 跑 `pnpm exec tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo`。

`tsconfig.json` 会把 `bin/visitor-realism-cross-model.ts` 的报告对象字面量传入 `buildMarkdown` 的结构化入参。对象先被 `const` 推断，`thinking: 'auto'` 被宽化为 `string`，再赋给要求 `RaterThinkingMode` 的字段时报错：

```text
bin/visitor-realism-cross-model.ts(428,9): error TS2322
Type '{ minimax: { model: string; thinking: string; }; ... }'
is not assignable to type '{ minimax: { model: string; thinking: RaterThinkingMode; }; ... }'
```

AF-227 本地只跑了 `tsconfig.check.json`，漏掉了这条宽度检查。

## 修复

只改一行：

```ts
minimax: { model: endpoints.minimax_t01.model, thinking: 'auto' as const },
```

用 `as const` 把 `'auto'` 收窄到字面量类型，满足 `RaterThinkingMode`。不改评分逻辑、统计阈值、提示词、报告字段或输出数据。

## 验证

| 闸门 | 结果 |
| --- | --- |
| CI 同款 `tsc -p tsconfig.json` | exit 0，0 error |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error / 0 warning |
| 定向 vitest 2 文件 | 8 tests passed |

AF-227 已归档，不能原地改写；AF-228 从 AF-227 HEAD 切 stacked 分支，保留原提交。PR #80 作为 superseded 关闭，由 AF-228 新 PR 承接完整提交链。

## 偏差与遗留

- 无行为变更；只做类型收窄。
- AF-227 的交付记录、回执与数据工件保持原样，不改历史证据。
- AF-227 的评分结论仍为 `conditional`，本修复不改变该结论。

## 机读字段标记

- `scopeCheck`：in-scope（仅 `bin/visitor-realism-cross-model.ts` 一行）
- `contractChecks`：taskId / state-write / index-schema / event-chain / engine-boundary 全部 pass
- `backlogItems`：无新增
- `deviationTable`：无
- `reviewVerdict`：passed

## commit message

`fix(af228): 收窄跨模型报告评分员 thinking 字面量类型`
