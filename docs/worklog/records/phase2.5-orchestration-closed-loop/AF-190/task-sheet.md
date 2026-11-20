---
taskId: AF-190
contextId: phase2.5-orchestration-closed-loop
title: 自动对练场景与输出完整性最终入账
type: fix
status: backlog
baselineRef: 4ca4dbe5c772bccc9bf1a3c73ad0dbc4a0e49866
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.2, conventions.md#1.3, conventions.md#5]
createdAt: 2026-11-20T18:48:00+08:00
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
    - docs/worklog/completed/phase2.5/af189-af187-encounter-delivery-2026-11-20.md
    - docs/worklog/completed/phase2.5/af190-encounter-delivery-final-2026-11-20.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af190-encounter-delivery-final-2026-11-20.md
    kind: report
gates:
  - command: pnpm lint
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
successCriteria:
  - 场景一级配置、输出完整性闸门、风险收束会话级账本、crisisOutcome 与导出字段全部入账，不回退
  - 单一执行提交不含 records，提交标题只含 AF-190，避免 PR 校验多任务编号
  - 全量 3949 例、lint、typecheck、前端 vue-tsc、preflight 真实通过，engine-core 零 diff
plannedArtifacts: []
requiredSkills: []
requiredTools: []
outOfScope:
  - src/engine-core/ 任何文件
  - Flutter 客户端代码
  - docs/worklog/records/（归档阶段单独提交）
constraints:
  - 不手改 journal / task-state-index
  - AF-187/AF-188/AF-189 历史原样保留
priorTasks: [AF-187, AF-188, AF-189]
---

# AF-190 · 自动对练场景与输出完整性最终入账

## 背景

AF-187/188/189 均完成技术实现，但分别因租约过期、records 越界、提交标题多任务编号被流程拦截。AF-190 用只含单一任务编号的提交做最终入账；技术内容与前三单完全一致，不回退。

## 验收

见 frontmatter `successCriteria` 与 `gates`；交付记录必须含六组机读字段标记。
