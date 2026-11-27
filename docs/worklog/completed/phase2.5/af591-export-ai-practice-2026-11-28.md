# AF-591 交付记录 — 用户数据导出纳入 AI 对话摘要与练习记录

- 任务单：`docs/worklog/records/phase2.5-quality-gates/AF-591/task-sheet.md`
- 分支：`task/AF-591-export-ai-practice`
- 基线：`1f7bc6ecf69e7348ebf77fd68de625f8ca60f35f`（AF-590 合并后）
- 日期：2026-11-28

## 问题

Phase4 WP29 的用户导出权此前只覆盖 profile 域 11 张表，AI 对话摘要、心理健身房练习场次与训练记录都在 `scope.pendingDomains` 里。用户下载自己的数据时，拿不到自己与 AI 的对话历史摘要，也拿不到训练记录，合规上属于「导出不完整」。

## 改动

| 文件 | 改动 |
| --- | --- |
| `src/profile/providers/user-data-export.collector.ts` | `EXPORT_SCHEMA_VERSION` 1.0 → 1.1；新增 `ChatSession` / `PracticeSession` / `PracticeRecord` 三个采集域，全部按 uid 查询并分别按 `createdAt` / `startedAt` / `completedAt` 倒序；`pendingDomains` 收敛为 `conversationMessages` / `memories` / `voiceTranscripts` |
| `src/profile/controllers/export.controller.ts` | 纵切说明更新为已覆盖对话摘要与练习记录，明确消息原文、记忆、语音转写仍待后续批次 |
| `test/profile/user-data-export.collector.spec.ts` | 新增 1 条三域查询/载荷用例；空结构断言补齐三域；防漏表清单从 11 张扩到 14 张 |
| `test/profile/export.spec.ts` | 最小载荷补三个空数组，schemaVersion 断言跟随 1.1 |

关键设计决策：

1. **只导出 `ai_chat_sessions` 摘要，不导出 `llm_conversations`**。后者带 token 计数、provider、crisis_event_id 与审计关联，属于内部计费 / 安全审计数据，不应进入用户数据包；而且没有摘要语义，混入会让用户误读。
2. **对话消息原文保持 pending**。服务端本来就不存原文（V2.0 §5.4 端侧加密），所以 `conversationMessages` 在 pending 里是「产品口径未定」，不是「漏做」。
3. **schemaVersion 升 1.1 而不是原地扩展**。下游解析方按版本识别字段集合，新增三个顶层数组必须显式升版。
4. **不做条数上限**。导出权应给全量；分页/流式是后续大数据量优化，不应在合规路径上先截断。

## 验证

- 定向：`pnpm exec vitest run test/profile/user-data-export.collector.spec.ts test/profile/export.spec.ts` → 2 files passed，18 passed / 0 failed，29.56s
- `pnpm typecheck` → 0 error
- `pnpm lint` → 0 error / 0 warning
- 全量：`pnpm test` → 366 passed / 1 skipped，5193 passed / 0 failed / 4 skipped，751.68s
- `git diff --stat HEAD -- src/engine-core` → 空

## 遗留

- **AF-591-B1**：导出包仍未加密、未走 presigned URL（承接 AF-586-B2）。现在包含对话摘要与训练反馈，文件泄露的隐私影响比之前更大，应优先做传输与静态加密。
- **AF-591-B2**：记忆与语音转写仍未纳入；分别依赖向量库导出能力与转写留存策略。
- **AF-591-B3**：导出为同步采集，数据量大时会拉长请求时间；后续应改异步任务 + 进度查询。
