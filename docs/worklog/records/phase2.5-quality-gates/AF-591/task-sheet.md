---
taskId: AF-591
contextId: phase2.5-quality-gates
title: 用户数据导出纳入 AI 对话摘要与练习记录
type: implementation
status: backlog
baselineRef: 1f7bc6ecf69e7348ebf77fd68de625f8ca60f35f
dependsOn: []
priorTasks: [AF-586, AF-590]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T06:40:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/profile/providers/user-data-export.collector.ts
    - src/profile/controllers/export.controller.ts
    - test/profile/user-data-export.collector.spec.ts
    - test/profile/export.spec.ts
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-quality-gates/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af591-export-ai-practice-2026-11-28.md
    kind: report
gates:
  - command: pnpm exec vitest run test/profile/user-data-export.collector.spec.ts test/profile/export.spec.ts
    check: 导出采集与导出服务单测全绿
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
  - 导出载荷新增 AI 对话摘要、练习场次、练习记录三个域，schemaVersion 升为 1.1
  - 三类数据均按 uid 查询并按业务时间倒序，不允许跨用户
  - includedDomains / pendingDomains 与实际覆盖一致，不再把已覆盖域写进 pending
  - 采集器单测覆盖新域查询参数、DTO 载荷与空结构
  - 导出服务单测跟随 schemaVersion 1.1
  - 定向测试、typecheck、lint 全绿，engine-core 零 diff
objective: 让用户导出权覆盖 AI 对话摘要与训练记录，缩小 WP29 合规缺口
outOfScope:
  - 不导出对话消息原文（服务端不存储）
  - 不导出 llm_conversations 的 token / 危机审计字段
  - 不做记忆与语音转写（仍为 pendingDomains）
  - 不做导出文件加密
constraints:
  - 所有新增查询必须带 uid 条件
  - 不改表结构、不加 migration
  - engine-core 零改动
---
