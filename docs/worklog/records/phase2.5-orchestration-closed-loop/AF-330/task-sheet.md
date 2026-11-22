---
taskId: AF-330
contextId: phase2.5-orchestration-closed-loop
title: 来访者真人度 prompt 分层消融 A/B
type: verification
status: backlog
baselineRef: 3835953bf0cc98f3c17d658b309ad6263db8c25a
dependsOn: [AF-329]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-23T03:20:00+08:00
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
    - realism-prompt-ablation
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af330-realism-prompt-ablation-2026-11-23.md
    kind: report
  - name: 消融实测报告
    path: docs/worklog/completed/phase2.5/af330-realism-prompt-ablation-report-2026-11-23.md
    kind: report
gates:
  - command: pnpm exec vitest run test/shared/realism/realism-prompt-ablation.spec.ts test/shared/realism/realism-prompt-ab.spec.ts
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
  - 用 AF-329 的生产同款块构造 5 个分支：off、full、quota、event、context；每个分支的块必须是生产块的逐字子集，full 必须等于生产块，off 必须为空。
  - 两个合成人设（焦虑依恋、回避依恋），每人设 5 分支 × 6 个合成咨询师轮次 × 2 次重复，真实调用豆包 Seed Character。
  - 输出每人设每分支的轮数、失败数、六类计数、事件/轮、轮次率、密度/百字、修正/轮，以及相对同人设 off 的差值；只输出数字，不输出完整台词。
  - 报告必须如实写方向与方差；不因为结果不符合预期而调 prompt 或挑选重复。
  - 不修改生产 prompt、不切 RENDER_REALISM_MODE、不写库、不启服务；只做离线性验证。
  - 单测覆盖 5 分支构造、逐字子集、人设差异、失败计入与聚合，至少 10 例。
  - 定向测试、typecheck、lint、全量测试、engine-core 零 diff 全部通过。
---

# AF-330 · 来访者真人度 prompt 分层消融 A/B

AF-329 证明「整块 humanization-v1 prompt 在 6 轮单一人设上没有稳定正向增益」，但没有回答是哪一层在起作用或抑制。本单把生产块拆成 quota / event / context 三个可归因层，在两个人设上做小规模真实消融，只回答「哪一层改变文本分布」，不宣称临床真人度。

## 边界

- 合成人设与合成咨询师台词，不使用真实咨询内容。
- 只调用豆包 Seed Character 生产模型，provider 固定 `doubao`。
- 不写库、不启服务、不改生产 prompt、不切 `RENDER_REALISM_MODE`。
- 原始 JSON 含 prompt 与合成台词，放 gitignored `data/phase25-exit/af330-realism-ablation/`，不入库；仓库报告只保留数字。
- 结果不能外推为所有来访者或临床有效性；重复次数与人数不足以做统计显著性声明。
