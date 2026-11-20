---
taskId: AF-103
contextId: phase2.5-exit4-quality-remediation
title: 批次入队前来访者角色存在性校验
type: fix
status: backlog
baselineRef: 9acd6d1fba8d0d05fc04178479a213947dcd6d34
dependsOn: [AF-102]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T20:20:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/auto-practice/auto-practice.controller.ts
    - src/auto-practice/auto-practice.module.ts
    - test/auto-practice/
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules:
    - auto-practice-intake
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af103-visitor-role-preflight-2026-11-18.md
    kind: report
gates:
  - command: corepack pnpm exec vitest run test/auto-practice/auto-practice-controller.spec.ts
    check: 入队前置校验单测全绿
    threshold: failed=0
  - command: corepack pnpm exec tsc --noEmit -p tsconfig.json
    check: 类型检查全绿
    threshold: error=0
successCriteria:
  - 批量入队前逐条校验 characterSlug 是否可解析；任何缺失角色都在入队前整体拒绝
  - 错误信息列出缺失的 slug，不静默跳过、不产生半批任务
  - 单场启动接口也做同一校验，错误口径一致
  - 校验复用现有 CHARACTER_PROFILE_RESOLVER，不新增角色数据源
  - 新增单测覆盖合法角色、缺失角色、部分缺失三种路径
  - engine-core 零 diff
---
# AF-103 批次入队前来访者角色存在性校验

## 背景

AF-097 long 批次 4 场只完成 3 场，1 场以「角色不存在」失败。当前 `POST /admin/api/auto-practice/batch`
直接把 slug 推进队列，角色不存在时在 runner 内才失败，造成半批数据与无效证据。

## 目标

1. 批量入队前用现有角色解析器校验每个 slug，缺失则整体拒绝。
2. 单场启动接口同口径校验。
3. 错误信息明确列出缺失 slug，便于调用方修正。
4. 不新增角色数据源，不改角色内容。

## 验收

- 单测覆盖合法、全缺失、部分缺失。
- 校验失败时队列零新增。
- `tsc --noEmit` exit 0，engine-core 零 diff。
