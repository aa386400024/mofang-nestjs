---
taskId: AF-333
contextId: phase2.5-orchestration-closed-loop
title: 真人度 12 轮长会话基线校准
type: verification
status: backlog
baselineRef: 80734563375195e3156e3ef82e0bc376ca1b9114
dependsOn: [AF-332]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-23T04:30:00+08:00
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
    - realism-long-session
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af333-realism-long-session-2026-11-23.md
    kind: report
  - name: 实测报告
    path: docs/worklog/completed/phase2.5/af333-realism-long-session-report-2026-11-23.md
    kind: report
gates:
  - command: pnpm exec vitest run test/shared/realism/realism-long-session.spec.ts test/shared/realism/realism-metric-distribution.spec.ts
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
  - 提供 12 个不重复的合成咨询师轮次，作为长会话 turn set；原有 6 轮短会话保持不变。
  - AF-331 CLI 新增 --turn-set short|long，默认 short；long 时跑满 12 轮，且每轮仍用同一合成人设与同一分支块。
  - 真实执行 4 次独立重复：2 人设 × 3 分支（off / full / minimal）× 12 轮 × 4 重复 = 288 次豆包 Seed Character 调用。
  - 用 AF-332 的分布 CLI 汇总，报告给出逐重复密度、均值、中位数、极值、窗口内计数，并与 AF-332 的 6 轮结果并列。
  - 报告必须回答：12 轮是否降低 off 密度方差、是否让 off 中位数进入窗口、full 是否仍稳定过量；不预设结论。
  - 不修改生产 prompt、不切 RENDER_REALISM_MODE、不写库、不启服务。
  - 单测覆盖 12 轮数量、唯一性、非空、默认 short、long 选择、越界抛错，至少 8 例。
  - 定向测试、typecheck、lint、全量测试、engine-core 零 diff 全部通过。
---

# AF-333 · 真人度 12 轮长会话基线校准

AF-332 发现 6 轮短会话的密度方差足以让 off 在 `1.35` 与 `4.72` 之间摆动，`2.50` 门槛无法区分基线与过量。本单不调阈值、不改 prompt，只把会话延长到 12 轮：同一组 off / full / minimal、同一模型、4 次重复，看密度是否因分母变长而收敛，以及 full 是否仍稳定超限。

## 边界

- 合成人设、合成咨询师台词；不使用真实咨询内容。
- 只调用豆包 Seed Character 生产模型，provider 固定 `doubao`。
- 不写库、不启服务、不改生产 prompt、不切 `RENDER_REALISM_MODE`。
- 原始 JSON 含 prompt 与合成台词，放 gitignored `data/phase25-exit/af333-realism-long-session/`，不入库；仓库报告只保留数字。
- 4 次重复、2 合成人设仍不足统计显著性；报告只给分布事实与工程建议。
