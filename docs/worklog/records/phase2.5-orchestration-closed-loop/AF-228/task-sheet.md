---
taskId: AF-228
contextId: phase2.5-orchestration-closed-loop
title: 修复 AF-227 CI 类型检查：跨模型报告评分员 thinking 字面量收窄
type: fix
status: backlog
baselineRef: dd44f92e20c73fc885772074a1342600603ca7bd
dependsOn: [AF-227]
priorTasks: [AF-207, AF-208, AF-209, AF-213, AF-214, AF-216, AF-225, AF-226, AF-227]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-21T17:25:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - bin/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af228-ci-typecheck-fix-2026-11-21.md
    kind: report
gates:
  - command: pnpm exec tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo
    check: 复现 CI 的 tsconfig.json 全量类型检查 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 仓库 typecheck 0 error
    threshold: exit=0
  - command: pnpm lint
    check: lint 0 error / 0 warning
    threshold: exit=0
  - command: pnpm exec vitest run test/auto-practice/af227-cross-model-analysis.spec.ts test/auto-practice/af227-rater-runtime.spec.ts
    check: 跨模型统计与评分运行时定向用例全绿
    threshold: exit=0
successCriteria:
  - 修复 bin/visitor-realism-cross-model.ts 报告模型里 thinking auto 被宽化为 string 的 CI 类型错误。
  - 不改变任何评分、统计、提示词或报告行为；只做类型收窄。
  - CI 同款 tsc 全量命令本地 0 error。
  - 新任务从 AF-227 HEAD 切 stacked 分支，保留原提交；PR 80 标记 superseded，新 PR 承接。
  - 交付记录、回执、归档与受保护 PR 齐全。
---

# AF-228 · 修复 AF-227 CI 类型检查

## 背景

AF-227 的 PR #80 13 项检查中 `Lint + Typecheck` 失败，本地 `pnpm typecheck` 却通过。差异在于 CI 跑的是：

```powershell
pnpm exec tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo
```

本地 `pnpm typecheck` 跑的是 `tsconfig.check.json`，漏掉了 `tsconfig.json` 下的报告对象字面量宽度检查。失败点：

```text
bin/visitor-realism-cross-model.ts(428,9): error TS2322
Type '{ minimax: { model: string; thinking: string; }; ... }'
is not assignable to type '{ minimax: { model: string; thinking: RaterThinkingMode; }; ... }'
```

## 修复范围

只改 `bin/visitor-realism-cross-model.ts` 中报告模型对象的 `thinking: 'auto'` 字面量收窄，不改评分逻辑、统计阈值、提示词或报告字段。

## 验收

1. CI 同款 tsc 命令 0 error。
2. `pnpm typecheck`、`pnpm lint`、定向 vitest 全绿。
3. PR 最终 HEAD 含 AF-228 completed/archived 与 passed durable 回执。
