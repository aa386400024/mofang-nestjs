---
taskId: AF-117
contextId: phase2.5-long-session-acceptance
title: AF-116 CI 全量类型检查与 lint 修复（stacked）
type: fix
status: ready
baselineRef: null
dependsOn: [AF-116]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T02:40:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - bin/ai-double-blind.ts
    - test/auto-practice/ai-double-blind.spec.ts
    - docs/worklog/completed/phase2.5/af116-ai-double-blind-panel-delivery-2026-11-19.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af117-ci-fix-delivery-2026-11-19.md
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
  - AF-116 已归档且 PR #44 因 CI 全量 tsc 失败未合并
  - 只修 CI 暴露的 bin/test 类型与 lint 问题，不改变评分/仲裁语义
  - 从 AF-116 HEAD 切 stacked 分支，不改已归档 AF-116 证据
  - PR 全绿后合并并 close supersede #44
---

# AF-117 · AF-116 CI 全量类型检查与 lint 修复

## 背景

AF-116 已归档，PR #44（head `c5da9ab`）的 `Lint + Typecheck` 失败。本地 `pnpm typecheck` 走 `tsconfig.check.json`，未覆盖 CI 的全量 `tsc -p tsconfig.json`；CI 抓到 bin/test 的类型与 lint 问题。

## 目标

在不改 AF-116 已归档证据、不改评分/仲裁语义的前提下，修复 `bin/ai-double-blind.ts` 与对应单测的严格类型问题，让 AF-116 + AF-117 在同一 stacked PR 通过 13 项 required checks。

## 硬约束

- 从 AF-116 HEAD `c5da9ab` 切 stacked 分支，不修改 AF-116 提交历史。
- 只改 scope 内文件；不新跑 LLM 批次；不动 engine-core。
- 闸门必须与 CI 同口径：全量 `tsc -p tsconfig.json` + `pnpm lint` + 定向 vitest + boundary。

## 验收

- CI `Lint + Typecheck` 转 success。
- AF-117 回执六组字段齐全，`events verify` 通过。
- AF-117 PR 合并后关闭/标记 supersede #44。
