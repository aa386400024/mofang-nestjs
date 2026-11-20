---
taskId: AF-198
contextId: phase2.5-orchestration-closed-loop
title: 自动对练交付与记录包最终合并
type: fix
status: backlog
baselineRef: 4ca4dbe5c772bccc9bf1a3c73ad0dbc4a0e49866
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.2, conventions.md#1.3, conventions.md#5]
createdAt: 2026-11-20T19:30:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/encounter/
    - src/shared/text/
    - src/engine-adapters/rendering/
    - src/engine-adapters/wiring/
    - src/auto-practice/
    - src/admin-debug/
    - src/migration/
    - bin/ormconfig.ts
    - admin-dashboard/src/
    - test/
    - docs/worklog/completed/phase2.5/af187-encounter-scene-output-integrity-2026-11-20.md
    - docs/worklog/completed/phase2.5/af188-af187-encounter-closure-2026-11-20.md
    - docs/worklog/completed/phase2.5/af189-af187-encounter-delivery-2026-11-20.md
    - docs/worklog/completed/phase2.5/af190-encounter-delivery-final-2026-11-20.md
    - docs/worklog/completed/phase2.5/af191-encounter-delivery-2026-11-20.md
    - docs/worklog/completed/phase2.5/af193-executor-card-records-2026-11-20.md
    - docs/worklog/completed/phase2.5/af194-encounter-delivery-2026-11-20.md
    - docs/worklog/completed/phase2.5/af197-encounter-delivery-2026-11-20.md
    - docs/worklog/completed/phase2.5/af198-encounter-delivery-2026-11-20.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-198/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af198-encounter-delivery-2026-11-20.md
    kind: report
gates:
  - command: pnpm exec eslint --no-cache "{src,test,bin}/**/*.ts"
    check: 0 error 0 warning
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm test -- test/auto-practice/af187-encounter-output-integrity.spec.ts
    check: 定向回归全绿
    threshold: exit=0
  - command: pnpm test
    check: 全量全绿
    threshold: exit=0
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包完整
    threshold: exit=0
successCriteria:
  - 场景一级配置、输出完整性闸门、风险收束会话级账本、crisisOutcome 与导出字段全部入账，不回退
  - 执行提交同时包含任务单、实现、前序交付记录与 submitted 状态面，CI per-commit 校验通过
  - 前序 AF-188/AF-193 交付记录随执行提交落地，worklog strict 通过
  - 提交标题只含 AF-198；回执与 completed 状态面单独提交
  - 全量测试、lint、typecheck、前端 vue-tsc、engine-core 零 diff 真实通过
plannedArtifacts: []
requiredSkills: []
requiredTools: []
outOfScope:
  - src/engine-core/ 任何文件
  - Flutter 客户端代码
constraints:
  - 不手改 journal / task-state-index
  - AF-187 至 AF-194 历史原样保留
priorTasks: [AF-187, AF-188, AF-189, AF-190, AF-191, AF-192, AF-193, AF-194]
---

# AF-198 · 自动对练交付与记录包最终合并

## 背景

AF-194 的业务实现与任务门已通过，但记录包严格校验发现 AF-188/AF-193 两份交付记录未进入执行提交，导致 `worklog verify --strict` 失败。AF-198 将这两份记录随执行提交一起落地，并把回执/完成态留在第二提交。

## 验收

见 frontmatter `successCriteria`。

