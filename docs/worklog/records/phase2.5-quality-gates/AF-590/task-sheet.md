---
taskId: AF-590
contextId: phase2.5-quality-gates
title: AI 对话历史去 sample 化并接真实表
type: implementation
status: backlog
baselineRef: 498185d15469435055bb5ba041f382e15c13d891
dependsOn: []
priorTasks: [AF-589]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T06:00:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/ai-companion/providers/ai-conversations.service.ts
    - test/ai-companion/ai-conversations.spec.ts
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-quality-gates/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af590-ai-conversations-real-data-2026-11-28.md
    kind: report
gates:
  - command: pnpm exec vitest run test/ai-companion/ai-conversations.spec.ts
    check: 对话历史服务单测全绿
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
  - listConversations 按 uid 查询 ai_chat_sessions，createdAt 倒序、最多 100 条
  - 没有数据时返回空列表，不再返回任何 sample 对话
  - 详情 / 删除继续只允许本人 uid，归档会话不可删
  - 单测覆盖查询参数、DTO 映射、空列表、越权与归档
  - 移除 sampleConversations 与相关占位注释
  - 定向测试、typecheck、lint 全绿，engine-core 零 diff
objective: 停止向用户展示伪造的 AI 对话历史，改为真实表查询，并补齐服务单测
outOfScope:
  - 不实现 ChatSession 的写入 / 摘要生成链路
  - 不改 ai_chat_sessions 表结构
  - 不做历史分页 UI
constraints:
  - 查询必须带 uid 条件，禁止跨用户
  - 不改 DTO 形状
  - engine-core 零改动
---
