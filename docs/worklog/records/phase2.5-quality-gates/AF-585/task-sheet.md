---
taskId: AF-585
contextId: phase2.5-quality-gates
title: 角色管理暴露不流利配置字段
type: implementation
status: backlog
baselineRef: c9888d8b7423a23f7d8f8aeb7a8b9cdd332f33fc
dependsOn: [AF-584]
priorTasks: [AF-584]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T03:32:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/realism/visitor-realism-profile.ts
    - src/shared/realism/index.ts
    - src/engine-adapters/wiring/character/character-profile.dto.ts
    - src/engine-adapters/wiring/character/character-profile.admin.service.ts
    - test/engine-adapters/wp9b-character-admin.spec.ts
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-quality-gates/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af585-admin-disfluency-fields-2026-11-28.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/wp9b-character-admin.spec.ts
    check: 角色管理单测全绿
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
  - 管理端新建 / 编辑 DTO 暴露 disfluencyLevel 与 disfluencyDensity，缺省可空
  - 管理端出参 CharacterProfileAdminDto 返回两字段，未标定为 null
  - create / update / toAdminDto 三处映射完整，update 支持显式 null 清空
  - 档位校验只认 none/light/natural/heavy，密度限制 [0,1]
  - 单测覆盖创建携带、编辑更新、显式 null 清空、未传字段原样保留
  - 定向测试、typecheck、lint 全绿，engine-core 零 diff
objective: 把 AF-584 已落地的角色级不流利配置从 seed/DB 维护提升为管理端可读可写的正式字段
outOfScope:
  - 不改 admin-dashboard 前端
  - 不新增 migration（AF-584 已加列）
  - 不标定任何角色具体数值
constraints:
  - 只复用 AF-584 的两列与 shared/realism 类型，不另造枚举
  - 未传字段必须原样保留，不能用 undefined 覆盖
  - 显式 null 要能清空回未标定状态
---
