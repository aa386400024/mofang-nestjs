# AF-128 · 可见输出推理标签泄漏的命名空间与孤立闭合清洗 — 交付记录

> **taskId**：AF-128 · **contextId**：phase2.5-ai-proxy-acceptance · **agentRole**：executor
> **分支**：`task/AF-152-quality-admin`（AF-127 完成后收口）· **基线**：`edcae81f46115cfed4cbe374045eb1b1b5dd44ec`
> **日期**：2026-11-19 实现 / 2026-11-20 验收 · **状态**：实现 + 定向/全量自测完成，任务已领取待回执归档

---

## 1. 结论

`packet-14` 第 29 轮咨询师台词末尾的 `</mm:think>` 已能在共享清洗函数中被删除；标准 `<think>`、命名空间 `<mm:think>`、未闭合尾块、孤立闭合标签与流式半截标签都有定向用例。

## 2. 改动

| 文件 | 改动 |
|---|---|
| `src/shared/llm/reasoning-text.ts` | `THINK_OPEN` / `THINK_CLOSE` 扩展为 `<(?:[a-z0-9]+:)?think>` / `</(?:[a-z0-9]+:)?think>`；`removeReasoningBlocks` 增加孤立闭合标签删除；`safeVisiblePrefix` 只扣留“命名空间 + think 前缀”的半截标签，避免把正常文本 `价格<5` 误当标签扣住 |
| `test/shared/af106-reasoning-text.spec.ts` | 新增命名空间/孤立闭合清洗、流式半截命名空间标签、`价格<5` 不误扣三组断言；共 7 例 |

## 3. 闸门

| # | 命令 | exit code | 结果 |
|---|---|---|---|
| 1 | `pnpm exec vitest run test/shared/af106-reasoning-text.spec.ts` | **0** | **7 tests passed** |
| 2 | `pnpm exec tsc --noEmit` | **0** | 0 error |
| 3 | `pnpm lint` | **0** | 0 error / 0 warning |
| 4 | `pnpm test`（全量收尾） | **0** | **221 files passed / 1 skipped；3892 tests passed / 4 skipped**（21.75s） |

## 4. 边界与遗留

- 不改咨询师 prompt、不改 engine-core、不改 ai-proxy 阈值；不调 LLM、不新跑练习批次。
- AF-127 已完成，AF-128 于 2026-11-20 提级并领取；代码按文件分组单独提交，不夹带 AF-127 改动。
- 纯函数清洗，无 IO / env / NestJS 依赖。

---

_2026-11-19 · executor · 未 commit / 未 push_
