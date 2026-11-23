---
taskId: AF-438
contextId: phase2.5-orchestration-closed-loop
title: 台账按 kernelRef 分组统计语料版本分布
type: implementation
status: backlog
baselineRef: f89aa09165acda2d403ddad1e9f8c4474e3e1add
dependsOn: [AF-437]
priorTasks: [AF-427, AF-428, AF-435]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T07:16:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/ops/quality/af427-operator-delta-ledger.mjs
    - scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs
    - docs/architecture/behavior-operator-delta-ledger-v1.0.md
    - docs/architecture/debug-corpus-kernel-version-drift-v1.0.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-438/
    - docs/worklog/completed/phase2.5/af438-kernelref-grouping-2026-11-24.md
    - docs/worklog/completed/phase2.5/af436-kernel-ref-fingerprint-2026-11-24.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af438-kernelref-grouping-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs
    check: 台账单测通过
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包校验 PASS
    threshold: exit=0
---

# 背景

AF-427 台账无法判断「某轮对话是哪版内核跑出来的」，AF-428 已证明语料跨版本混杂。AF-437（executor）负责在 `src` 侧落 `kernelRef` 指纹；本单负责台账侧按该字段分组，并把「版本分布」表补进台账正文。

# 目标

1. `loadOperatorCorpusStats` 收集 `kernelRef`：按会话计数与轮次计数分桶，缺字段归 `legacy`。
2. 台账新增「表四 · 语料版本分布」，明确同一 `kernelRef` 内部才可横比。
3. 单测覆盖：混入两个 `kernelRef` 的合成语料 → 分桶正确；无字段 → `legacy`。
4. 同步台账正文与漂移取证文档的读法（不再说「待核实」）。

# 做法

- 脚本内新增 `byKernelRef`（`{ ref, sessions, turns }`）与 `kernelRefStatus`（`'fingerprinted' | 'legacy-only'`）。
- 渲染：表四按 `ref` 排序，`legacy` 置底；正文加一句「本表是 AF-428 结论的可执行落地」。
- 单测用临时目录写两场合成会话（一场带 `kernelRef`，一场不带）。

# 成功判据

1. 现有语料（无指纹）在表四显示为 `legacy`，脚本仍可跑通（`--json` 含 `byKernelRef`）。
2. 合成两版本语料分桶正确。
3. 闸门：定向 vitest 全绿、`pnpm lint` 0 error、`worklog verify --strict` PASS。
