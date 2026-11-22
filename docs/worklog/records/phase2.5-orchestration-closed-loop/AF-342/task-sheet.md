---
taskId: AF-342
contextId: phase2.5-orchestration-closed-loop
title: 真人度签名判据 v1 与零调用回验
type: implementation
status: backlog
baselineRef: e91497412a3f0c6d1245f49ef206e4df75229b47
dependsOn: [AF-341, AF-338]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-23T06:30:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/realism/
    - bin/
    - test/shared/realism/
    - docs/worklog/completed/
    - docs/worklog/records/
  modules:
    - visitor-realism
  interfaces:
    - realism-humanization-judge
artifacts:
  - name: 签名判据模块
    path: src/shared/realism/realism-humanization-judge.ts
    kind: code
  - name: 回验 CLI
    path: bin/visitor-realism-humanization-judge.ts
    kind: code
  - name: 单测
    path: test/shared/realism/realism-humanization-judge.spec.ts
    kind: test
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af342-realism-signature-judge-2026-11-23.md
    kind: report
  - name: 回验报告
    path: docs/worklog/completed/phase2.5/af342-realism-signature-judge-report-2026-11-23.md
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
  - 新增纯函数判据 `realism-signature-judge-v1`：按人设检查签名事件，再用密度上限分三态 off-like / humanized / overloaded。
  - 判据常量全部带来源：签名阈值取自 off 16 的上界并留余量，密度上限沿用 full-only 报警线 4.943817。
  - CLI 只读已归档 rep 文件，零模型调用，回验 off 16 / full 16 / minimal 16 / typed 16 / typed-noshape 16 / shape-capped 16 / tightened 16。
  - 回验必须给出：off 误报率、full 签名覆盖率、各臂三态分布与逐样本判定。
  - 单测覆盖三态、两个人设、边界阈值、非法输入，不少于 12 例。
  - 不改生产 prompt、不切 RENDER_REALISM_MODE、不替换 humanization-v1（只在影子层新增判据）。
---

# AF-342 · 真人度签名判据 v1 与零调用回验

AF-339/340/341 证明密度维度上「进窗」与「可分」互斥。本单不再调 prompt，改用结构签名做判据：先看人设签名事件是否保留，再看密度是否过载，输出三态；并用现有 112 个已归档样本零调用回验。

## 边界

- 纯函数 + 离线 CLI；零网络、零随机、零写库。
- 生产渲染、`RENDER_REALISM_MODE`、`humanization-v1` 阈值全部不动。
- 判据是工程结构代理，不是临床真人度。
