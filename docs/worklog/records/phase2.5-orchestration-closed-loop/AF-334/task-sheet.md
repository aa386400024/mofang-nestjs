---
taskId: AF-334
contextId: phase2.5-orchestration-closed-loop
title: 真人度 12 轮长会话层归因消融
type: verification
status: backlog
baselineRef: 83c0bf7b21e6bba88baf80ff2a3cef7a0e47be31
dependsOn: [AF-333]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-23T04:36:00+08:00
deadline: 2026-11-23T07:00:00+08:00
agentRole: executor
scope:
  files:
    - docs/worklog/pending/
    - docs/worklog/completed/
    - docs/worklog/records/
  modules:
    - visitor-realism
  interfaces:
    - realism-prompt-ablation
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af334-realism-long-session-ablation-2026-11-23.md
    kind: report
  - name: 实测报告
    path: docs/worklog/completed/phase2.5/af334-realism-long-session-ablation-report-2026-11-23.md
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
  - 复用 AF-331 CLI 的 --turn-set long，在 12 轮长会话下跑 7 分支：off / full / no-shape / no-event / no-quota / minimal / tightened。
  - 真实执行 4 次独立重复：2 人设 × 7 分支 × 12 轮 × 4 重复 = 672 次豆包 Seed Character 调用，报告失败数。
  - 用 AF-332 分布 CLI 汇总，逐分支给出逐重复密度、均值、中位数、极值、窗口内计数。
  - 报告必须回答：长会话里事件层是否仍是最大放大器、配额层与形态层各自贡献、minimal 与 tightened 是否仍不足以回到窗口。
  - 不修改生产 prompt、不切 RENDER_REALISM_MODE、不写库、不启服务、不调 threshold。
  - typecheck、lint、全量测试、engine-core 零 diff 全部通过。
---

# AF-334 · 真人度 12 轮长会话层归因消融

AF-333 证明 12 轮没有修好 off 基线，full 仍稳定过量。本单在 12 轮口径下重跑 AF-331 的 7 分支消融，回答长会话里哪一层仍在持续放大口语事件：事件层、配额层、形态层，还是它们叠加。

## 边界

- 合成人设、合成咨询师台词；不使用真实咨询内容。
- 只调用豆包 Seed Character 生产模型，provider 固定 doubao。
- 不写库、不启服务、不改生产 prompt、不切 RENDER_REALISM_MODE、不调 humanization-v1 阈值。
- 原始 JSON 含 prompt 与合成台词，放 gitignored data/phase25-exit/af334-realism-long-session-ablation/，不入库。
- 4 次重复、2 合成人设仍不足统计显著性；报告只给分布事实与工程建议。
