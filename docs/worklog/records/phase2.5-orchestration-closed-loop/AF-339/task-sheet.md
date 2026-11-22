---
taskId: AF-339
contextId: phase2.5-orchestration-closed-loop
title: 真人度分型候选 typed 臂实测
type: implementation
status: backlog
baselineRef: 9cca72ea0b9c3ae387c32065b530bc81ec516a77
dependsOn: [AF-338]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-23T05:32:00+08:00
deadline: 2026-11-23T07:00:00+08:00
agentRole: executor
scope:
  files:
    - src/shared/realism/realism-prompt-tightening.ts
    - test/shared/realism/realism-prompt-tightening.spec.ts
    - docs/worklog/pending/
    - docs/worklog/completed/
    - docs/worklog/records/
  modules:
    - visitor-realism
  interfaces:
    - realism-prompt-tightening
artifacts:
  - name: 分型候选臂
    path: src/shared/realism/realism-prompt-tightening.ts
    kind: code
  - name: 单测
    path: test/shared/realism/realism-prompt-tightening.spec.ts
    kind: test
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af339-realism-typed-arm-2026-11-23.md
    kind: report
  - name: 实测报告
    path: docs/worklog/completed/phase2.5/af339-realism-typed-arm-report-2026-11-23.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量测试全绿
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: 输出为空
    threshold: exit=0
successCriteria:
  - 新增 `typed` 臂：焦虑禁用 repair、只留 filler/pause、单轮最多 1 处；回避把 pause 压到每两轮一次、只留 trailoff/pause。
  - 只改配额与事件两行，形态层与其余行逐字保留；单测覆盖行数、替换行数与关键词。
  - 用 12 轮 long 跑 8 次 typed（2 人设 × 8 × 12 = 192 次调用），0 失败。
  - 用 AF-338 剖面工具输出 typed 六类事件频次，并与 AF-336 off、AF-337 full/minimal 对比。
  - 明确回答：typed 是否把密度压回 full 以下、是否保住 repair 之外的真人度信号、能否与 off 区分。
  - 不改生产 prompt、不切 RENDER_REALISM_MODE、不调 humanization-v1 阈值。
---

# AF-339 · 真人度分型候选 typed 臂实测

AF-338 证明焦虑 full 的过密一半来自 repair、回避 full 的过密来自“每轮必有 pause”。本单新增一个实验臂 `typed`：按人设分别压 repair / pause，保留形态层与其余行，验证能否在不删除全部真人度信号的前提下把密度压回窗口。

## 边界

- 只新增离线实验臂，不改生产块、不切模式、不写库。
- 合成人设与合成台词；只调用豆包 Seed Character。
- 原始 JSON 放 gitignored data/phase25-exit/af339-realism-typed-arm/。
- 这是工程候选，不是临床真人度结论。
