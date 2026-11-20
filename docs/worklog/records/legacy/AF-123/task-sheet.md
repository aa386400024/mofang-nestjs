---
taskId: AF-123
contextId: phase2.5-long-session-acceptance
title: AF-116/AF-117/AF-119/AF-120 单任务整合发布（executor 资源域精确）
type: fix
status: ready
baselineRef: null
dependsOn: []
priorTasks: [AF-116, AF-117, AF-119, AF-120]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T02:57:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - bin/ai-double-blind.ts
    - src/auto-practice/metrics/ai-double-blind.ts
    - test/auto-practice/ai-double-blind.spec.ts
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af123-single-release-2026-11-19.md
    kind: report
gates:
  - command: pnpm exec tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo
    check: CI 全量类型检查 0 error
    threshold: 0 error
  - command: pnpm lint
    check: lint 0 error / 0 warning
    threshold: 0 error / 0 warning
  - command: pnpm exec vitest run test/auto-practice/ai-double-blind.spec.ts test/engine-core/boundary.spec.ts
    check: 26 tests passed
    threshold: 26 passed / 0 failed
successCriteria:
  - AF-116/AF-117/AF-119/AF-120 内容在同一分支，但多任务提交被 CI 任务门拒绝
  - 从 integrate 重建单任务发布分支，只保留 AF-123 单一任务号，内容不丢
  - scope 精确落在 executor Agent Card 资源域：src/ bin/ test/ docs/worklog/pending/ docs/worklog/completed/
  - CI 13 项 required checks 全绿后合并，关闭 supersede PR #44
---

# AF-123 · 单任务整合发布（资源域精确）

## 背景

AF-116 已归档；PR #44 因 CI 全量 tsc 失败未合并。AF-117/AF-119/AF-120 修复与回执完成，但 stacked 分支多任务号提交被 `ci-task-gate` 拒绝。AF-121/122 因 scope 含 `docs/team`、`web`、`docs/worklog/` 根目录超出 executor 资源域被拦。

## 目标

从 `integrate` 重建单任务分支 `task/AF-123-release`，把 AF-116 以来的全部代码与文档作为一个 AF-123 交付提交；scope 只写 executor 资源域精确前缀；PR 单任务号、13 项检查全绿后合并，关闭 #44。

## 硬约束

- 内容不丢：AF-116 AI 双盲模块与证据、AF-117 CI 修复、AF-119/AF-120 验收修正全部保留。
- 编排状态面由 CLI 生成，按框架从 scope 比对剔除，不写入 `scope.files`。
- 不新跑 LLM 批次；不改评分/仲裁语义；不触碰 engine-core。

## 验收

AF-123 回执六组字段齐全；`events verify` 通过；PR 全绿并 squash 合并。
