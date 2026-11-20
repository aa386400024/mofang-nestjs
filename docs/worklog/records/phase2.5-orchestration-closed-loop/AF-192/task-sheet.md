---
taskId: AF-192
contextId: phase2.5-orchestration-closed-loop
title: 自动对练场景与输出完整性最终交付
type: fix
status: backlog
baselineRef: 4ca4dbe5c772bccc9bf1a3c73ad0dbc4a0e49866
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.2, conventions.md#1.3, conventions.md#5]
createdAt: 2026-11-20T19:05:00+08:00
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
    - docs/worklog/completed/phase2.5/af191-encounter-delivery-2026-11-20.md
    - docs/worklog/completed/phase2.5/af192-encounter-delivery-2026-11-20.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-192/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af192-encounter-delivery-2026-11-20.md
    kind: report
gates:
  - command: pnpm lint
    check: 0 error 0 warning
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm exec eslint test/auto-practice/af187-encounter-output-integrity.spec.ts --no-cache
    check: 定向 eslint 无缓存验证
    threshold: exit=0
  - command: pnpm test -- test/auto-practice/af187-encounter-output-integrity.spec.ts
    check: 定向回归全绿
    threshold: exit=0
  - command: pnpm test
    check: 全量全绿
    threshold: exit=0
successCriteria:
  - 场景一级配置、输出完整性闸门、风险收束会话级账本、crisisOutcome 与导出字段全部入账，不回退
  - 执行提交同时包含任务单与代码，满足 CI per-commit task-sheet 校验
  - 测试文件无未使用符号，CI lint/typecheck 可复现通过
  - 单一执行提交不含 receipt/state，提交标题只含 AF-192
  - 全量 3948 例、lint、typecheck、前端 vue-tsc、preflight、engine-core 零 diff 真实通过
plannedArtifacts: []
requiredSkills: []
requiredTools: []
outOfScope:
  - src/engine-core/ 任何文件
  - Flutter 客户端代码
constraints:
  - 不手改 journal / task-state-index
  - AF-187/AF-188/AF-189/AF-190/AF-191 历史原样保留
priorTasks: [AF-187, AF-188, AF-189, AF-190, AF-191]
---

# AF-192 · 自动对练场景与输出完整性最终交付

## 背景

技术实现已完成；前序五单分别因租约、records 越界、提交标题、回执工件、CI task-sheet 逐提交校验与未使用符号被流程拦截。AF-192 将任务单纳入 scope 并与代码同提交，修复 eslint 未使用符号后完成最终入账。

## 验收

见 frontmatter `successCriteria`。
