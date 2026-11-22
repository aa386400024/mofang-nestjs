---
taskId: AF-332
contextId: phase2.5-orchestration-closed-loop
title: 真人度短会话基线方差与配对中位数校准
type: verification
status: backlog
baselineRef: 3d608aaf6251924564374cfaede56f184edaca07
dependsOn: [AF-331]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-23T04:10:00+08:00
deadline: 2026-11-23T19:00:00+08:00
agentRole: executor
scope:
  files:
    - bin/
    - test/
    - src/shared/realism/
    - docs/worklog/pending/
    - docs/worklog/completed/
    - docs/worklog/records/
  modules:
    - visitor-realism
  interfaces:
    - realism-metric-distribution
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af332-realism-baseline-variance-2026-11-23.md
    kind: report
  - name: 实测报告
    path: docs/worklog/completed/phase2.5/af332-realism-baseline-variance-report-2026-11-23.md
    kind: report
gates:
  - command: pnpm exec vitest run test/shared/realism/realism-metric-distribution.spec.ts test/shared/realism/realism-prompt-tightening.spec.ts
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
  - 新增纯分布模块，计算均值、中位数、最小、最大、样本数与判据窗口内计数；缺失/非有限值不参与统计。
  - 新增离线分析 CLI，读取多份 AF-331 单重复报告并输出每人设每分支的密度、事件/轮、轮次率、修正/轮分布与逐重复值。
  - 真实执行 6 次独立重复：2 人设 × 3 分支（off / full / minimal）× 6 轮 × 6 重复 = 216 次豆包 Seed Character 调用。
  - 报告必须给出逐重复密度、均值、中位数、最小/最大与窗口内计数，并比较均值与中位数的差异；不得只报均值。
  - 报告必须判断 off 基线的「假设性 active 窗口通过率」，并明确它是工程校准，不是生产 gate。
  - 不修改生产 prompt、不切 RENDER_REALISM_MODE、不写库、不启服务。
  - 单测覆盖奇数/偶数中位数、缺失值、空数组、单样本、窗口计数与非有限值，至少 8 例。
  - 定向测试、typecheck、lint、全量测试、engine-core 零 diff 全部通过。
---

# AF-332 · 真人度短会话基线方差与配对中位数校准

AF-330 与 AF-331 已暴露同一问题：6 轮、2 重复的短会话密度方差足以让 off 基线在 `1.59` 与 `3.22` 之间摆动，`humanization-v1` 的 `density_per100 ≤ 2.50` 因此不能直接当稳定判据。本单不改门槛、不改 prompt，只把方差测清楚：同一组 off / full / minimal 重复 6 次，记录每次的密度与事件指标，用均值和配对中位数并列呈现，判断 off 基线到底在哪个区间。

## 边界

- 合成人设、合成咨询师台词；不使用真实咨询内容。
- 只调用豆包 Seed Character 生产模型，provider 固定 `doubao`。
- 不写库、不启服务、不改生产 prompt、不切 `RENDER_REALISM_MODE`。
- 原始 JSON 含 prompt 与合成台词，放 gitignored `data/phase25-exit/af332-realism-baseline/`，不入库；仓库报告只保留数字。
- 6 次重复仍不足以做统计显著性声明；报告只给分布事实与工程建议。
