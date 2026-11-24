# AF-493 · AF-478 缓存观测与 paired 重跑收口（单提交）

## 背景

AF-478 的实现与 AF-481 的接线在同一工作树完成，提交拆分后 AF-478 分支单独检出时 `voice.service.ts` 读取了尚未声明的 `cachedTokens`，`pnpm lint` 报 `no-unsafe-assignment`。AF-478 已归档，无法在分支名与 commit trailer 一致的前提下继续用 AF-478 提交修复；AF-486 收口时又因 PR 历史保留 AF-478 提交标题，被 CI 判双任务号。

## 处理

- 从 `integrate` 重建分支 `task/AF-493-af478-squash`，相对 `integrate` 只有一个提交。
- 提交内容：AF-478 的 22 个文件 + `voice.service.ts` 自洽修复 + `RC-AF-478-2` + 本交付记录。
- `buildLlmDoneUsage(usage: LlmUsage & { cachedTokens?: number })`，不修改 `src/agent/llm/llm.types.ts`，不重复 AF-481 的类型补丁。
- RC-1 保持冻结；RC-2 按提交 `221475aa` 的 22 个文件判定 `in-scope`。
- 旧 #232、#236 关闭，标注 superseded-by-487。

## 闸门

- `pnpm lint`：0 error。
- `pnpm typecheck`：0 error。
- `receipt lint --taskId AF-478 --path .../receipt-RC-AF-478-2.json`：PASS。
- `worklog verify --strict`：PASS。

## 说明

六个 `wiring/observability/agent-llm` 文件不在本提交，由 AF-481 承接。本 PR 只解决 AF-478 的提交自洽与 scope 判定，不改变 600 轮评测数据与成本结论。
