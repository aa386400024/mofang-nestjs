# AF-590 交付记录 — AI 对话历史去 sample 化并接真实表

- 任务单：`docs/worklog/records/phase2.5-quality-gates/AF-590/task-sheet.md`
- 分支：`task/AF-590-ai-conversations-real-data`
- 基线：`498185d15469435055bb5ba041f382e15c13d891`（AF-589 合并后）
- 日期：2026-11-28

## 问题

`AiConversationsService.listConversations(_uid)` 完全忽略 uid 与数据库，永远返回 `sampleConversations()` 里 6 条硬编码心理对话（`sample-c1` ~ `sample-c6`）。任何用户打开「我的数据 → AI 对话记录」看到的都是同一批虚构的焦虑、失眠、家庭冲突摘要。这不是 demo 装饰，而是**向用户展示伪造的心理历史**，同时把「`ai_chat_sessions` 没有写入链路」这一真实缺口藏在假数据后面。

## 改动

| 文件 | 改动 |
| --- | --- |
| `src/ai-companion/providers/ai-conversations.service.ts` | `listConversations` 改为 `repo.find({ where: { uid }, order: { createdAt: 'DESC' }, take: 100 })`；删除 `sampleConversations()` 与相关 V2 占位注释；详情、删除逻辑保持原 uid 约束 |
| `test/ai-companion/ai-conversations.spec.ts` | 新增 7 条用例：查询参数与 DTO 映射、空列表不回落 sample、摘要字段缺失兜底、详情带 uid、越权 404、归档不可删、删除条件带 uid |

关键设计决策：

1. **只读真实表，不做「空表回填 sample」的降级**。空列表是诚实的：用户没有对话，就显示没有对话。任何「看起来有内容」的兜底都会再次制造假记录。
2. **不加 `llm_conversations` 桥接**。该表是流式会话的 token / 危机审计记录，没有摘要、情绪、轮数语义，也不能走现有删除接口；把它映射成历史条目会污染语义并威胁审计数据完整性。历史页与实时会话的桥接需要单独的产品与数据口径，另立任务。
3. **不实现 `ai_chat_sessions` 写入链路**。写入需要接入实时对话结束事件与摘要生成，涉及 LLM 调用与心理内容处理，超出本任务边界；本任务先把「展示层不再伪造」这一半闭环。

## 验证

- 定向：`pnpm exec vitest run test/ai-companion/ai-conversations.spec.ts` → 7 passed / 0 failed，18.74s
- `pnpm typecheck` → 0 error
- `pnpm lint` → 0 error / 0 warning
- 全量：`pnpm test` → 366 passed / 1 skipped，5192 passed / 0 failed / 4 skipped，740.77s
- `git diff --stat HEAD -- src/engine-core` → 空

## 遗留

- **AF-590-B1**：`ai_chat_sessions` 仍无任何 writer，真实对话结束后不会产生历史记录；需要接入对话生命周期 + 摘要生成（含隐私边界评审）。
- **AF-590-B2**：`llm_conversations` 与 `ai_chat_sessions` 的桥接 / 合并口径未定，需产品与数据架构确认。
- **AF-590-B3**：历史列表固定上限 100 条，无分页与游标；数据量上来后需要 cursor 分页。
