# AF-592 交付记录 — 收紧 LLM 会话历史接口并修正 404 语义

- 任务单：`docs/worklog/records/phase2.5-quality-gates/AF-592/task-sheet.md`
- 分支：`task/AF-592-chat-history-contract`
- 基线：`2370ee9d60f66f33fbc7e7a06a5bbed96d2cbb87`（AF-591 合并后）
- 日期：2026-11-28

## 问题

`GET /v1/chat/conversations` 与 `GET /v1/chat/conversations/:id` 面向普通登录用户，却直接回传 `promptTokens`、`completionTokens`、`crisisEventId`、`providerId`、`model`。前三项分别属于内部计费与危机审计数据：token 数会暴露商业化成本结构，`crisisEventId` 会泄露危机干预留痕的存在。会话不存在时：列表接口不校验 `limit`，`?limit=abc` 会把 `NaN` 传给 TypeORM；详情接口抛裸 `Error`，返回 500 而非 404。

## 改动

| 文件 | 改动 |
| --- | --- |
| `src/ai-engine/controllers/llm-chat.controller.ts` | 列表 / 详情改用 `ChatConversationSummaryDto` 投影，只返回 `id` / `tier` / `title` / `startedAt` / `endedAt`；`@Query()` 改为 DTO 校验 |
| `src/ai-engine/dto/llm-chat.dto.ts` | 新增 `ChatHistoryQueryDto`（`@Type(Number)` + `@IsInt` + `@Min(1)` + `@Max(100)`）与 `ChatConversationSummaryDto` |
| `src/ai-engine/providers/llm-orchestrator.service.ts` | 详情不存在与客户端传入他人 `conversationId` 统一抛 `BizException(LlmConversationNotFound)`，不再抛裸 `Error` / `NotFoundException` |
| `src/common/exceptions/biz-code.enum.ts` | 新增 `LlmConversationNotFound = 26_002` |
| `src/common/exceptions/biz.exception.ts` | 新码默认文案；`ChatSessionNotFound` 与新码一起归入 404 映射 |
| `test/ai-engine/llm-chat-conversations.spec.ts` | 7 条用例：安全投影字段白名单、limit 透传与缺省、详情投影、limit 边界、404 业务码与 HTTP 状态 |

关键设计决策：

1. **直接删除敏感字段，不做「admin 才返回」的分支**。该 controller 只有 JWT 守卫，没有管理员角色判断；要保留内部字段就得先建一套 admin 授权，属于另一个任务。用户历史页不需要 token / crisis id，删掉是成本最低且最安全的契约。
2. **`ChatSessionNotFound` 一并归 404**。它此前落在默认 400，跟「参数错误」混淆；这是同一次契约修正里顺手补上的真实缺陷。
3. **limit 用 DTO 而不是 controller 手写 parse**。全局 `ValidationPipe` 已开启 `transform + whitelist`，DTO 校验能同时挡住 `NaN`、小数、越界与多余参数。

## 验证

- 定向：`pnpm exec vitest run test/ai-engine/llm-chat-conversations.spec.ts` → 7 passed / 0 failed，23.20s
- `pnpm typecheck` → 0 error
- `pnpm lint` → 0 error / 0 warning
- 全量：`pnpm test` → 367 passed / 1 skipped，5200 passed / 0 failed / 4 skipped，736.94s
- `git diff --stat HEAD -- src/engine-core` → 空

## 遗留

- **AF-592-B1**：响应删除 `providerId` / `model` / token / crisis 字段属于 breaking change；若前端或其他调用方正在消费，需要同步改客户端。
- **AF-592-B2**：`/v1/chat/once` 注释写「admin 后台测试 / 批量评估」，但同样只有 JWT 守卫，任意用户可调用非流式补全；是否需要 admin 权限待产品确认。
- **AF-592-B3**：会话历史仍无分页游标，limit 上限 100；数据量增长后需要 cursor 分页。
