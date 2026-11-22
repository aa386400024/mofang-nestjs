---
taskId: AF-335
contextId: phase2.5-orchestration-closed-loop
title: 真人度基线分离度与阈值敏感性
type: implementation
status: backlog
baselineRef: 9106b77ef6f7a477c2e7fa7af405354f03284fbd
dependsOn: [AF-334]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-23T04:54:00+08:00
deadline: 2026-11-23T07:00:00+08:00
agentRole: executor
scope:
  files:
    - src/shared/realism/
    - bin/
    - test/
    - docs/worklog/pending/
    - docs/worklog/completed/
    - docs/worklog/records/
  modules:
    - visitor-realism
  interfaces:
    - realism-sample-separation
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af335-realism-threshold-sensitivity-2026-11-23.md
    kind: report
  - name: 实测报告
    path: docs/worklog/completed/phase2.5/af335-realism-threshold-sensitivity-report-2026-11-23.md
    kind: report
gates:
  - command: pnpm exec vitest run test/shared/realism/realism-sample-separation.spec.ts
    check: 定向单测全绿
    threshold: exit=0
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
  - 新增纯模块 realism-sample-separation.ts，提供负/正样本分离区间、单阈值混淆矩阵与窗口内计数，零 IO。
  - 新增分析 CLI bin/visitor-realism-gate-sensitivity.ts，读取多份 summary.json，按人设与分支对 off vs full / off vs minimal / off vs tightened 计算分离区间、最佳阈值与混淆矩阵。
  - 单测覆盖完全分离、重叠、空样本、单样本、相等边界、NaN 过滤与混淆矩阵计数，至少 8 例。
  - 用 AF-333 与 AF-334 的 8 个 off 样本做真实汇总，报告给出候选阈值区间与不可分结论，不调 threshold、不改生产 prompt。
  - 定向测试、typecheck、lint、全量测试、engine-core 零 diff 全部通过。
---

# AF-335 · 真人度基线分离度与阈值敏感性

AF-333/334 已给出 12 轮下 off / full / minimal / tightened 的 8 次重复分布，但仍没有回答“如果要设 gate，哪个阈值能把过量与基线分开、哪些候选根本不可分”。本单只做分析工具与敏感性报告，不调 `humanization-v1`、不改生产、不宣称临床有效性。

## 边界

- 只读本地 JSON，不调模型、不写库、不启服务。
- 合成人设与合成台词；所有阈值只是工程敏感性，不是临床标尺。
- 不切换 `RENDER_REALISM_MODE`；原始数据继续留在 gitignored 取证目录。
