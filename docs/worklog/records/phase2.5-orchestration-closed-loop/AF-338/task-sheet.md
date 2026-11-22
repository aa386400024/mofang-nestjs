---
taskId: AF-338
contextId: phase2.5-orchestration-closed-loop
title: 真人度事件类型归因与剖面工具
type: implementation
status: backlog
baselineRef: 947454fa5b33365dea9871b23df191f7d6d6d2ee
dependsOn: [AF-337]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-23T05:22:00+08:00
deadline: 2026-11-23T07:00:00+08:00
agentRole: executor
scope:
  files:
    - src/shared/realism/
    - bin/
    - test/shared/realism/
    - docs/worklog/pending/
    - docs/worklog/completed/
    - docs/worklog/records/
  modules:
    - visitor-realism
  interfaces:
    - realism-event-type-profile
artifacts:
  - name: 事件类型剖面模块
    path: src/shared/realism/realism-event-type-profile.ts
    kind: code
  - name: 归因 CLI
    path: bin/visitor-realism-event-type-profile.ts
    kind: code
  - name: 单测
    path: test/shared/realism/realism-event-type-profile.spec.ts
    kind: test
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af338-realism-event-type-attribution-2026-11-23.md
    kind: report
  - name: 实测报告
    path: docs/worklog/completed/phase2.5/af338-realism-event-type-attribution-report-2026-11-23.md
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
  - 新增纯函数模块，把每个 cell 的六类事件计数（filler / pause / repetition / repair / trailoff / elongation）折算成每轮频次与类型占比。
  - 新增 CLI，读取 rep JSON 目录，按人设 × 分支输出事件类型剖面；--reps>1 的聚合文件必须显式拒绝，避免把均值当总数。
  - 单测覆盖：空样本、零轮次、缺失/非法计数、排序稳定、占比合计、repair 频次、聚合不修改输入。
  - 用 AF-336 off 8 份与 AF-337 full/minimal 8 份真实样本产出剖面 JSON，并在报告里回答“哪类事件把 full 拉过上限”。
  - 不改 humanization-v1 阈值、不改生产 prompt、不切 RENDER_REALISM_MODE、不写库。
  - typecheck、lint、全量测试、engine-core 零 diff 全部通过。
---

# AF-338 · 真人度事件类型归因与剖面工具

AF-334 的层消融证明事件层是最大放大器，AF-337 证明 full 与 off 仍有空档但 minimal 落回 off 侧；现在缺的是“六类事件里到底哪几类在放大”。本单新增纯函数剖面工具与 CLI，从已有 rep JSON 的 `meanTypeCounts` 计算每轮频次与类型占比，零模型调用。

## 边界

- 纯函数零 IO / 零随机 / 零文本；CLI 只读已有 rep JSON。
- 不新增模型调用、不改生产 prompt、不改阈值、不写库。
- 原始剖面 JSON 放 gitignored data/phase25-exit/af338-realism-event-type-attribution/。
- 这是工程归因，不是临床真人度结论。
