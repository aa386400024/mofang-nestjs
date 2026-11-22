---
taskId: AF-340
contextId: phase2.5-orchestration-closed-loop
title: 真人度形态层限次候选 shape-capped
type: implementation
status: backlog
baselineRef: 04990ede0f6abf504d63b54f0ee914c0647ce770
dependsOn: [AF-339]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-23T05:50:00+08:00
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
  - name: 形态限次候选
    path: src/shared/realism/realism-prompt-tightening.ts
    kind: code
  - name: 单测
    path: test/shared/realism/realism-prompt-tightening.spec.ts
    kind: test
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af340-realism-shape-capped-2026-11-23.md
    kind: report
  - name: 实测报告
    path: docs/worklog/completed/phase2.5/af340-realism-shape-capped-report-2026-11-23.md
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
  - 新增 `shape-capped` 臂：只改形态层一行，把“每轮执行”压成“整场最多三次、本轮最多一次”；配额层与事件层逐字保留。
  - 单测覆盖行数、只改一行、保留原配额与事件行、两个人设的形态文本。
  - 用 12 轮 long 跑 8 次 shape-capped（2 人设 × 8 × 12 = 192 次调用），0 失败。
  - 用分布 CLI 与剖面 CLI 对比 off/full/typed/typed-noshape，回答“只压形态层能否进窗口、是否保住事件多样性”。
  - 不改生产 prompt、不切 RENDER_REALISM_MODE、不调 humanization-v1 阈值。
---

# AF-340 · 真人度形态层限次候选 shape-capped

AF-339 证明形态层是事件主驱动：保留就压不下来，删除就回到 off。本单只改形态层一行，把“每轮执行”改成“整场最多三次、本轮最多一次”，配额与事件层原样保留，验证能否在保住事件多样性的前提下进窗口。

## 边界

- 只新增离线实验臂，不改生产块、不切模式、不写库。
- 合成人设与台词；只调用豆包 Seed Character。
- 原始 JSON 放 gitignored data/phase25-exit/af340-realism-shape-capped/。
- 工程候选，不是临床真人度结论。
