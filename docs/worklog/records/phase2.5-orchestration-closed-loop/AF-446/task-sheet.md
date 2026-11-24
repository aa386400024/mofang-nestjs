---
taskId: AF-446
contextId: phase2.5-orchestration-closed-loop
title: 修正 deliberation-types 中在场状态 delta 种子的过期注释
type: implementation
status: backlog
baselineRef: 8cd5be58ec1902ac46a7bb92a2a6feb79ab81d09
dependsOn: []
priorTasks: [AF-445, AF-444]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T09:05:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/deliberation/deliberation-types.ts
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-446/
    - docs/worklog/completed/phase2.5/af446-deliberation-comment-2026-11-24.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af446-deliberation-comment-2026-11-24.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
---

# 背景

`src/engine-adapters/deliberation/deliberation-types.ts` 第 101 行（D-2 段落）写着「两类的 delta 种子是 ZERO, 没有"规则可覆盖的 delta"可对齐」。该前提已被 AF-322 标定推翻：内核 `state-transition.ts` 的 `holding_present` / `cold_absent` 都有真实非零系数。

# 目标

只改注释，不动任何代码与枚举：

1. 删除「两类的 delta 种子是 ZERO」这句过期论据，替换为当前真实系数（引用内核事实）。
2. 保留仍然成立的理由：规则轨词表不扩 → 规则侧产不出这两个标签；影子对比两侧同口径。
3. 明示结论仍是「暂不纳入 `DELIBERATION_RULE_ALIGNED_TAGS`」，但依据换成词表覆盖而非零 delta；是否纳入仍留标定批次评估。

# 事实（必须与实际代码一致）

- `holding_present`：trust 0 / safety +0.004 / bond +0.002 / verbal −0.002 / valence +0.004 / arousal −0.002，其余 0。
- `cold_absent`：trust −0.004 / safety −0.002 / bond −0.002 / verbal +0.004 / depth +0.002 / style +0.002 / valence −0.004 / negative +0.002，其余 0。

# 成功判据

1. `pnpm typecheck` 0 error、`pnpm lint` 0 error（注释改动不应影响任何闸门）。
2. `git diff` 只包含 `deliberation-types.ts` 的注释行与交付记录/记录包。
3. `src/engine-core` 零 diff。
