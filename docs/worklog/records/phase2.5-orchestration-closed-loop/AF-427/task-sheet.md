---
taskId: AF-427
contextId: phase2.5-orchestration-closed-loop
title: 行为算子 delta 幅度台账 v1.0：13 算子 11 维系数、单事件 cap 占用与语料覆盖缺口
type: implementation
status: backlog
baselineRef: 67e54372e171920fad603e667b181cfce59cb9b7
dependsOn: []
priorTasks: [AF-426, AF-421, AF-422]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T06:05:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/ops/quality/af427-operator-delta-ledger.mjs
    - scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs
    - docs/architecture/behavior-operator-delta-ledger-v1.0.md
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af427-operator-delta-ledger-2026-11-24.md
    kind: report
  - name: 算子台账
    path: docs/architecture/behavior-operator-delta-ledger-v1.0.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs
    check: 解析器、cap 占用、语料覆盖与台账渲染断言全绿
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量用例全绿
    threshold: exit=0
---

# 背景

AF-426 的在场 delta 标定台账只覆盖了 `holding_present` / `cold_absent` 两类在场事件，并在遗留项里记了一条：11 个行为算子的幅度标定尚未成台账（候选 AF426-B2）。

而内核 `src/engine-core/cognition/state-transition.ts` 的 `DELTA_TABLE` 是 13 个算子 × 11 维的硬编码系数表，每个算子都写了「单事件达上向 cap 的 X%」这类注释，但**没有任何一处把 13 个算子的 cap 占用、语料覆盖、方向偏置汇总到一起**。结果是：改了某个维度系数后，没人能一眼看出「这个算子还有多少余量」「这个算子在我们的语料里到底跑没跑过」。

# 目标

产出一份可复算的算子台账，回答三个问题：

1. 13 个算子 × 11 维的系数分别是什么（从内核源码**解析**得到，不手抄，避免第四份漂移拷贝）。
2. 每个算子单事件的最大 cap 占用比是多少，谁最接近触顶，哪些维度的余量最薄。
3. 13 个算子里有几个在现有 13 场语料里真的出现过——没出现过的算子其系数从未被行为验证。

# 做法

- `scripts/ops/quality/af427-operator-delta-ledger.mjs`：只读脚本。
  - `parseDeltaTable(sourceText)`：正则切 `DELTA_TABLE = { ... }` 块，按算子块提取 `dim: number` 字面量，跳过注释与嵌套；返回 13 × 11 完整矩阵，缺维度直接报错（不允许静默补 0）。
  - `CAP_BOUNDS`：与 AF-422 同口径的 cap 镜像；`operatorCapUsage(table)` 算逐维占用比与算子最大值。
  - `loadOperatorCorpusStats({ dir })`：扫 `data/debug-sessions/*.json`，按 `traces[].deltaDetail.events` 统计每个算子命中的轮次数、多算子同轮拆分计数、以及实现 delta 的逐维均值。
  - CLI 默认打印 Markdown 三段表 + 覆盖缺口清单；**不打印任何对话原文**。
- `scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs`：解析器 13 键 / 11 维齐全、注释与嵌套不被误吃、cap 占用与手算一致、语料统计对合成夹具正确、渲染含断言关键行。
- `docs/architecture/behavior-operator-delta-ledger-v1.0.md`：台账正文（三张表 + 覆盖缺口 + 读法）。

# 成功判据

1. 台账里的 13 × 11 系数能被脚本从源码重新解析出来，且与内核对拍。
2. 每个算子的单事件最大 cap 占用有数字，能指出最接近触顶的算子。
3. 明确列出「零语料算子」清单，并说明其系数属于未验证状态。
4. `pnpm lint` / `pnpm typecheck` / 定向 vitest / 全量 `pnpm test` 全绿，`src/engine-core` 零 diff。
