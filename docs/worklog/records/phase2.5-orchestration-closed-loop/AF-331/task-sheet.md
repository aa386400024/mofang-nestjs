---
taskId: AF-331
contextId: phase2.5-orchestration-closed-loop
title: 来访者真人度 prompt 减层与候选收紧离线验证
type: verification
status: backlog
baselineRef: 65bc2c4326c865ebd1640cbbee04e5c3e542baf2
dependsOn: [AF-330]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-23T03:45:00+08:00
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
    - realism-prompt-tightening
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af331-realism-prompt-tightening-2026-11-23.md
    kind: report
  - name: 实测报告
    path: docs/worklog/completed/phase2.5/af331-realism-prompt-tightening-report-2026-11-23.md
    kind: report
gates:
  - command: pnpm exec vitest run test/shared/realism/realism-prompt-tightening.spec.ts test/shared/realism/realism-prompt-ablation.spec.ts
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
  - 构造 7 个分支：off、full、no-shape、no-event、no-quota、minimal、tightened；no-shape/no-event/no-quota/minimal 必须是 full 的逐字减行，tightened 只替换指定三行。
  - 两个合成人设（焦虑依恋、回避依恋），每人设 7 分支 × 6 个合成咨询师轮次 × 2 次重复，真实调用豆包 Seed Character。
  - 输出每人设每分支的轮数、失败数、六类计数、事件/轮、轮次率、密度/百字、修正/轮，以及相对同人设 off 的差值；只输出数字，不输出完整台词。
  - 报告必须如实写方向与方差；不因为结果不符合预期而调 prompt 或挑选重复；未落进判据窗口就写未落进。
  - 不修改生产 prompt、不切 RENDER_REALISM_MODE、不写库、不启服务；只做离线性验证。
  - 单测覆盖 7 分支构造、逐字减行、tightened 只改指定三行、人设差异、未知人设抛错与聚合，至少 10 例。
  - 定向测试、typecheck、lint、全量测试、engine-core 零 diff 全部通过。
---

# AF-331 · 来访者真人度 prompt 减层与候选收紧离线验证

AF-330 已定位：steady 下生产块的「话轮形态层」逐轮命令改口/停顿，「事件层」列四类候选并附带节奏条件，叠加后密度到 6-8。本单先做**减层**（从 full 逐字删掉指定一行/两行）确认哪一层是必要条件，再用一个**收紧候选**验证「形态可选 + 事件单点 + 整场配额」能否把密度拉回 `humanization-v1` 窗口。

## 边界

- 合成人设与合成咨询师台词，不使用真实咨询内容。
- 只调用豆包 Seed Character 生产模型，provider 固定 `doubao`。
- 不写库、不启服务、不改生产 prompt、不切 `RENDER_REALISM_MODE`。
- 原始 JSON 含 prompt 与合成台词，放 gitignored `data/phase25-exit/af331-realism-tightening/`，不入库；仓库报告只保留数字。
- 结果不能外推为所有来访者或临床有效性；两人设两次重复不足以做统计显著性声明。
