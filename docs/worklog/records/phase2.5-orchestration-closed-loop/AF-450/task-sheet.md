---
taskId: AF-450
contextId: phase2.5-orchestration-closed-loop
title: 台账按 kernelRef 与合成标记分组统计语料版本分布
type: implementation
status: backlog
baselineRef: 15044d68ee650fb9a0ee11764c22b260082b33e0
dependsOn: []
priorTasks: [AF-449, AF-427, AF-435]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T10:30:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/ops/quality/af427-operator-delta-ledger.mjs
    - scripts/orchestration/__tests__/af450-ledger-segmentation.spec.mjs
    - docs/architecture/behavior-operator-delta-ledger-v1.0.md
    - docs/worklog/pending/af450-ledger-kernelref-grouping-task-2026-11-24.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-450/
    - docs/worklog/completed/phase2.5/af450-ledger-kernelref-grouping-2026-11-24.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af450-ledger-kernelref-grouping-2026-11-24.md
    kind: report
gates:
  - command: node scripts/ops/quality/af427-operator-delta-ledger.mjs --dir data/debug-sessions
    check: 表三只统计真实语料，合成语料单列，kernelRef 分布可见
    threshold: exit=0
  - command: pnpm exec vitest run scripts/orchestration/__tests__/af450-ledger-segmentation.spec.mjs
    check: 分组单测全绿
    threshold: exit=0
---

# 背景

AF-449 落库后 `data/debug-sessions/` 里出现 6 场 `synthetic: true` 的剧本语料。`af427-operator-delta-ledger.mjs` 的 `loadOperatorCorpusStats` 按文件名前缀全量读，合成语料与真实用户会话混进同一张表三，导致：

- 表三的「实测/系数比」被合成语料拉高，读者无法判断真实语料下的算子幅度；
- 表三标题写死「13 场 debug 会话」，与真实会话数不符；
- 会话上的 `kernelRef`（AF-442 起写入的内核版本指纹）没有被任何统计使用，语料版本漂移不可见（原承接单 AF-438 挂 `dependsOn: [AF-437]` 永不满足）。

# 目标

1. `loadOperatorCorpusStats` 增加 `scope` 选项：`real`（排除 `synthetic: true`）/ `synthetic`（只统计合成）/ `all`（默认，保持向后兼容）。
2. 新增按 `kernelRef` 分组统计：每个 kernelRef 下的会话数、轮次、其中合成会话数；缺 `kernelRef` 的会话归入 `none` 桶。
3. 渲染侧：表三改为**真实语料**口径并动态写会话数，新增「合成语料覆盖」副表与「kernelRef 分布」表。
4. 补分组单测，锁住 scope 过滤与 kernelRef 分桶行为。

# 边界

- 只改台账脚本与其单测、台账架构文档的口径说明；不改内核、不改分类器、不改 `data/debug-sessions/` 里的数据文件。
- 不打印任何对话原文。

# 成功判据

1. `node scripts/ops/quality/af427-operator-delta-ledger.mjs --dir data/debug-sessions` exit=0，表三只含真实会话，合成覆盖单列，kernelRef 分布表出现。
2. `pnpm exec vitest run scripts/orchestration/__tests__/af450-ledger-segmentation.spec.mjs` 全绿。
3. `pnpm typecheck` 0 error；`git diff --stat HEAD -- src/engine-core` 为空。
