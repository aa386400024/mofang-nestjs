---
taskId: AF-428
contextId: phase2.5-orchestration-closed-loop
title: 语料与内核版本漂移取证：同一算子同一事件在语料里出现多套 delta 签名
type: investigation
status: backlog
baselineRef: 67e54372e171920fad603e667b181cfce59cb9b7
dependsOn: []
priorTasks: [AF-427, AF-426]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T06:30:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/architecture/debug-corpus-kernel-version-drift-v1.0.md
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af428-corpus-version-drift-2026-11-24.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包校验 PASS
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
---

# 背景

AF-427 台账表三里 `empathy` 的「实测/系数比 = 88.0%」被标为待核实：表值 safety 0.060，而语料实测 safety 均值只有 0.0140。AF-427 回执把它登记为候选 AF427-B1，理由是「语料快照可能生成于 safety 提到 0.06 之前」。

复核时发现这条候选解释只对了一半：**语料里同一个算子、同一类单算子轮，出现了多套不同的 delta 签名**，说明 13 场会话是跨多个内核版本攒起来的混合快照，不是「一刀切」的旧版。

# 目标

把「语料跨版本」这件事取证到可复核的程度，回答：

1. 哪些算子的语料签名与当前 `DELTA_TABLE` 一致，哪些不一致。
2. 不一致的能分出几套签名、各覆盖多少轮。
3. 这对 AF-427 表三的「实测/系数比」意味着什么（能不能用、怎么用）。

# 做法

- 只读统计 `data/debug-sessions/*.json` 的单算子轮 `deltaDetail.evidence` 签名（8 维 + events），按签名分簇计数。
- 与 AF-427 脚本解析出的当前 `DELTA_TABLE` 逐维对拍。
- 结论写成一页取证记录，含逐簇表与处置建议；不改语料、不改内核、不重跑会话。

# 成功判据

1. 每个算子的语料签名簇、轮次数、与当前表是否一致，都有数字。
2. 明确给出「表三实测/系数比可以怎么用、不能怎么用」的结论。
3. 给出可执行的处置建议（重跑语料 / 按签名分簇统计 / 保留并标注）。
