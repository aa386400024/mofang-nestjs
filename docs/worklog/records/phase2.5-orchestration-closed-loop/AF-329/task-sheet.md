---
taskId: AF-329
contextId: phase2.5-orchestration-closed-loop
title: 来访者文字真人度 active/off prompt A/B smoke
type: verification
status: backlog
baselineRef: d2036b019b51caf9787c4f449a2c806f5667eed7
dependsOn: [AF-328]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-23T03:00:00+08:00
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
    - realism-prompt-ab
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af329-realism-prompt-ab-2026-11-23.md
    kind: report
  - name: A/B 实测报告
    path: docs/worklog/completed/phase2.5/af329-realism-prompt-ab-report-2026-11-23.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/metrics/humanization-acceptance.spec.ts test/shared/realism/realism-prompt-ab.spec.ts
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
  - 新增离线 A/B CLI：同一合成来访者人设、同一组 6 个咨询师轮次，分别用 active 与 off system prompt 真实调用豆包 Seed Character。
  - active 分支 system prompt 必须逐字包含 buildVisitorRealismProfile(active) 的 directives；off 分支必须不包含该块，且两分支其余 prompt 逐字一致。
  - 输出只含数字：每分支 visitor 轮数、六类计数、事件/轮、轮次率、密度/百字、修正/轮，以及 active-off 差值；不输出任何完整台词。
  - 真实跑一次 A/B，报告写清模型、温度、超时、调用数、失败数与数字；失败调用如实计入，不静默丢弃。
  - 判据同时给 audit（只测量）与 active（假设性判定）两种视图，明确不宣称注入链路有效或临床有效。
  - 单测覆盖 prompt 分支构造、情绪标签剥离、消息序列、分支汇总与差值，至少 8 例。
  - 定向测试、typecheck、lint、全量测试、engine-core 零 diff 全部通过。
---

# AF-329 · 来访者文字真人度 active/off prompt A/B smoke

AF-328 给出了 humanization-v1 判据与历史语料基线，但没有回答「active 注入是否真的让来访者文本更像真人」。本单在**不依赖 MySQL / Redis / dev 服务**的前提下，用生产 `LlmService` 直接做一次同人设、同轮次的 active / off prompt A/B，只回答 prompt 层是否改变文本分布，不冒充生产全链路或临床结论。

## 边界

- 合成来访者人设与合成咨询师台词，不使用任何真实咨询内容。
- 只调用豆包 Seed Character 生产模型，provider 固定 `doubao`。
- 不写库、不启服务、不改渲染链路、不切 `RENDER_REALISM_MODE`。
- 报告只含数字，不输出完整台词；结果不能外推为临床真人度。
