# AF-497 · 缓存观测与 paired 重跑最终单提交合并

## 背景

AF-478 与 AF-481 的实现最初在同一工作树完成，提交拆分后 AF-478 分支单独检出时 `voice.service.ts` 读取了尚未声明的 `cachedTokens`，`pnpm lint` 报 `no-unsafe-assignment`。AF-478 已归档，无法续用原任务号；多次收口又因历史提交标题或分支 slug 带 AF-478 被 CI 判双任务号。

## 处理

- 从 `integrate` 重建 `task/AF-497-cache-squash`，相对 `integrate` 单提交。
- 内容：AF-478 的 22 个文件 + `voice.service.ts` 自洽修复 + `RC-AF-478-2` + 本交付记录。
- `buildLlmDoneUsage(usage: LlmUsage & { cachedTokens?: number })`，不改 `src/agent/llm/llm.types.ts`，不重复 AF-481 的类型补丁。
- RC-1 保持冻结；RC-2 按提交 `221475aa` 的 22 个文件判定 `in-scope`。
- 旧 #232/#236/#237/#238 关闭，标注 superseded-by-495。

## 闸门

- `pnpm lint`：0 error。
- `pnpm typecheck`：0 error。
- `receipt lint --taskId AF-478 --path .../receipt-RC-AF-478-2.json`：PASS。
- `worklog verify --strict`：PASS。

## 说明

六个 `wiring/observability/agent-llm` 文件不在本提交，由 AF-481 承接。本 PR 不改变 600 轮评测数据与成本结论。
