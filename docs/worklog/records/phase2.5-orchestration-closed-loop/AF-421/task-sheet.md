---
taskId: AF-421
contextId: phase2.5-orchestration-closed-loop
title: 在场 delta 幅度扫描：按倍数看末态增益与饱和，给标定批次一个可复算的区间
type: investigation
status: backlog
baselineRef: 7275462bb9cc677fe5f1e96747a906a6894d401e
dependsOn: []
priorTasks: [AF-418, AF-420]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T05:00:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/ops/quality/
    - scripts/orchestration/__tests__/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af421-presence-amplitude-sweep-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/af421-presence-amplitude-sweep.spec.mjs
    check: 倍数单调性 / 1× 等于 AF-418 基线 / 0× 零漂移断言全绿
    threshold: exit=0
  - command: node scripts/ops/quality/af421-presence-amplitude-sweep.mjs --dir data/debug-sessions
    check: 只读跑通，输出不含对话原文
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量测试全绿，记录真实数字
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty
successCriteria:
  - 对 presence delta 施加 0× / 0.25× / 0.5× / 1× / 2× / 4× / 8× 七档倍数，逐轮重放（真实快照差 + 当轮 scaled presence delta，每步夹取）
  - 输出每档的批次末态 safety / bond 总增益、平均单场增益、触顶（clamp）场次、末态 safety 均值
  - 1× 档必须与 AF-418 重放基线逐字一致（作为口径不漂的证明），0× 档基线漂移必须为 0
  - 给出「达到 +0.05 / +0.10 平均末态增益」所需的最低倍数（不可达则显式写不可达），给标定批次一个区间而不是拍脑袋
  - 只读 data/debug-sessions，不打印对话原文，不写仓库数据文件
  - lint / typecheck / 定向单测 / 全量测试全绿；engine-core 零 diff
---

## 背景

AF-420 把 `ENGINE_DELTA_HOLDING_PRESENT` / `ENGINE_DELTA_COLD_ABSENT` 接进了 env 端口，标定批次从此能改幅度。但「改到多大」没有依据：AF-418 只证明了 1× 种子幅度下的末态增量（13 场 safety +0.4660 / bond +0.2320），没有给倍数-增益关系，也没有说清放大到多少会先撞 clamp（而不是 cap）。

## 目标

1. 新增只读脚本 `af421-presence-amplitude-sweep.mjs`：复用 AF-418 的快照差重放，把 presence delta 按倍数缩放后逐轮叠加，输出 7 档倍数下的末态增益与饱和。
2. 单测钉三条口径：1× 与 AF-418 基线逐字一致；倍数单调（正维度增益随倍数不减）；0× 零漂移。
3. 交付记录给「倍数 → 平均末态增益 → 触顶场次」的表，并给出达 +0.05 / +0.10 的所需倍数或「不可达」结论。

## 范围隔离

只新增脚本、单测、交付记录、记录包；只读 `data/debug-sessions`；不改内核 delta 表、不改 env 默认值、不碰分类器与 prompt。
