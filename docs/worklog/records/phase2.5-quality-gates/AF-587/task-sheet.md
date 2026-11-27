---
taskId: AF-587
contextId: phase2.5-quality-gates
title: 账号硬擦除覆盖关系型 uid 列
type: implementation
status: backlog
baselineRef: fec854029e8d16e8e45ea1dcee7d17ac741c1b37
dependsOn: []
priorTasks: [AF-586]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T04:38:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/user/providers/account-erasure.service.ts
    - test/user/account-erasure.spec.ts
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-quality-gates/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af587-account-erasure-uid-columns-2026-11-28.md
    kind: report
gates:
  - command: pnpm exec vitest run test/user/account-erasure.spec.ts
    check: 擦除服务单测全绿
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
  - 擦除服务识别 uid / user_id / *_uid 三类用户归属列
  - 一张表有多个归属列（owner_uid + companion_uid）时按列逐一删除，不重复计表
  - audit_logs 继续保留，users 最后删除
  - 无归属列的表跳过
  - 单测覆盖列匹配、保留表、多列、跳过表与 SQL 参数
  - 定向测试、typecheck、lint 全绿，engine-core 零 diff
objective: 修复账号硬擦除只匹配 uid / user_id 导致陪伴、舒缓卡、康复项等 *_uid 表漏删的合规缺陷
outOfScope:
  - 不新增 migration
  - 不改 retentionDays / 删除入口
  - 不改 audit_logs 留存策略
constraints:
  - 表名只来自 TypeORM metadata，禁止用外部输入拼 SQL
  - 单事务内完成，失败整体回滚
  - 保留表与 users 表跳过逻辑不变
---
