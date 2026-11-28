---
taskId: AF-593
contextId: phase2.5-quality-gates
title: AI 流式对话落会话摘要元数据
type: implementation
status: backlog
baselineRef: 0ea1efb88a0d975524751975d20724b6a4efaff3
dependsOn: []
priorTasks: [AF-590, AF-592]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T07:30:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/ai-companion/providers/chat-session-recorder.ts
    - src/ai-companion/ai-conversations.module.ts
    - src/ai-engine/ai-engine.module.ts
    - src/ai-engine/providers/llm-orchestrator.service.ts
    - test/ai-companion/chat-session-recorder.spec.ts
    - test/ai-engine/llm-chat-conversations.spec.ts
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-quality-gates/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af593-chat-session-writer-2026-11-28.md
    kind: report
gates:
  - command: pnpm exec vitest run test/ai-companion/chat-session-recorder.spec.ts test/ai-engine/llm-chat-conversations.spec.ts
    check: 会话写入器与历史接口单测全绿
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
  - 流式对话结束后按 uid + conversationId 写入 ai_chat_sessions，标题取首条 user 消息截断 80 字
  - 已有会话更新时保留原标题与创建时间，roundCount 取历史最大值
  - 不存消息原文与 assistant 回复，summaryText 保持 null
  - 写入失败只记录 warn，不打断已完成的对流
  - 高危危机直出路径同样落会话元数据
  - 单测覆盖首写、更新保留、空消息跳过、写入失败容错
  - 定向测试、typecheck、lint 全绿，engine-core 零 diff
objective: 让 AF-590 接通的真实历史页有数据来源，同时不把消息原文落服务端
outOfScope:
  - 不做 LLM 摘要生成
  - 不做历史分页、删除或归档接口
  - 不改 ai_chat_sessions 表结构
constraints:
  - 只写摘要标题与元数据，不写消息原文或 assistant 全文
  - 写失败不得改变对话主链路的成功语义
  - engine-core 零改动
---
