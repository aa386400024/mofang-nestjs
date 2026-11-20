---
taskId: AF-105
contextId: phase2.5-exit4-quality-remediation
title: 修复 AF-103 引入的批次入口测试装配回归
type: fix
status: backlog
baselineRef: 529ab0f3cad5eff8f8ba0894250a2e100eb5a942
dependsOn: [AF-103]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T22:40:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - test/auto-practice/batch-scenario-type.spec.ts
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules:
    - auto-practice-intake
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af105-ci-test-assembly-fix-2026-11-18.md
    kind: report
gates:
  - command: corepack pnpm exec vitest run test/auto-practice/batch-scenario-type.spec.ts
    check: 批次入口单测全绿
    threshold: failed=0
successCriteria:
  - batch-scenario-type 的 Nest 测试模块补上 AF-103 新增的角色解析器依赖，测试可正常 init/close
  - 只改测试装配，不改生产代码行为
  - 单测 10 条全部通过
  - 不引入新的测试替身真相源，直接复用现有 CHARACTER_PROFILE_RESOLVER token
  - engine-core 零 diff
---
# AF-105 修复 AF-103 引入的批次入口测试装配回归

## 背景

AF-103 给 AutoPracticeController 增加了入队前的角色存在性校验，注入 `CHARACTER_PROFILE_RESOLVER`。
`test/auto-practice/batch-scenario-type.spec.ts` 仍按旧的 6 个 provider 装配 Nest 测试模块，
beforeEach 解析依赖失败，`app` 未创建，afterEach 读 `app.close()` 抛 TypeError；远端 Unit shard 1/2/3 因此全红。

## 目标

在该测试模块补上角色解析器替身，让测试回到“只测 scenarioType 透传”的原始边界。

## 非目标

- 不改生产控制器、不改解析器实现、不扩大校验范围。
- 不为通过测试而放宽任何生产类型或注入可选依赖。

## 实现要点

- 引入 `CHARACTER_PROFILE_RESOLVER` token；
- provider 列表增加恒可解析替身（`resolve` 返回固定 displayName）；
- 真实“角色缺失拒绝”路径仍由 `auto-practice-controller.spec.ts` 覆盖，不在本文件重复。

## 验收

- `batch-scenario-type.spec.ts` 10/10 通过；
- 远端 Unit 与 Coverage 不再因该文件失败。
