---
taskId: AF-592
contextId: phase2.5-quality-gates
title: 收紧 LLM 会话历史接口并修正 404 语义
type: implementation
status: backlog
baselineRef: 2370ee9d60f66f33fbc7e7a06a5bbed96d2cbb87
dependsOn: []
priorTasks: [AF-590]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T07:00:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/ai-engine/controllers/llm-chat.controller.ts
    - src/ai-engine/providers/llm-orchestrator.service.ts
    - src/ai-engine/dto/llm-chat.dto.ts
    - src/common/exceptions/biz-code.enum.ts
    - src/common/exceptions/biz.exception.ts
    - test/ai-engine/llm-chat-conversations.spec.ts
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-quality-gates/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af592-chat-history-contract-2026-11-28.md
    kind: report
gates:
  - command: pnpm exec vitest run test/ai-engine/llm-chat-conversations.spec.ts
    check: 会话历史接口单测全绿
    threshold: 0 failed
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exit 0
  - command: pnpm lint
    check: Lint 0 error
    threshold: exit 0
  - command: git diff --stat HEAD -- src/engine-core
    check: 内核零改动
    threshold: empty output
successCriteria:
  - 会话列表响应不再暴露 promptTokens / completionTokens / crisisEventId / providerId / model
  - 列表 limit 由 DTO 校验为 1..100 的整数，非法输入返回 400
  - 会话不存在抛 LlmConversationNotFound，HTTP 状态为 404
  - ChatSessionNotFound 也归入 404 映射
  - 单测覆盖安全投影、limit 边界、404 业务码与 HTTP 状态
  - 定向测试、typecheck、lint 全绿，engine-core 零 diff
objective: 阻止用户接口泄露内部计费与危机审计字段，并让不存在的会话返回正确 404
outOfScope:
  - 不改会话表结构
  - 不做会话删除或分页游标
  - 不改流式对话主链路
constraints:
  - 只读接口投影，不写库
  - 所有查询仍带 uid 条件
  - engine-core 零改动
---
