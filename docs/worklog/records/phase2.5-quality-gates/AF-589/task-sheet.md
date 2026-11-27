---
taskId: AF-589
contextId: phase2.5-quality-gates
title: 账号硬擦除覆盖 *_user_id 与双人树归属列
type: implementation
status: backlog
baselineRef: d1cf5da6f079a36f46f3620918fb324adf206990
dependsOn: []
priorTasks: [AF-587]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T05:40:00+08:00
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
    path: docs/worklog/completed/phase2.5/af589-account-erasure-relation-columns-2026-11-28.md
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
  - 覆盖 actor_user_id / picked_by_user_id 等 *_user_id 归属列
  - 覆盖 companion_tree 的 owner_a_id / owner_b_id
  - provider_user_id 这类第三方用户 id 不纳入，避免误删/误匹配
  - 多列表逐列删除且去重计表
  - 单测覆盖新增列、排除列与原有 uid / user_id / *_uid 行为
  - 定向测试、typecheck、lint 全绿，engine-core 零 diff
objective: 继续补齐账号硬擦除的归属列识别，覆盖双人树与行为日志中未以 *_uid 命名的用户列
outOfScope:
  - 不新增 migration
  - 不改保留表 audit_logs
  - 不改 retentionDays / 删除入口
constraints:
  - 归属列规则必须可解释、可测试，禁止用泛化 *_id 误伤业务外键
  - 表名与列名只来自 TypeORM metadata
  - 单事务内完成，失败整体回滚
---
