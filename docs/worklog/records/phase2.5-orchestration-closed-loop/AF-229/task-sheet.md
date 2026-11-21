---
taskId: AF-229
contextId: phase2.5-orchestration-closed-loop
title: R6-D2 AI 层面锚点校准与豆包 thinking 对照
type: implementation
status: backlog
baselineRef: a99032327c7adc70011d7e2bd18e5932172a2b50
dependsOn: [AF-227]
priorTasks: [AF-227, AF-228]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-21T17:40:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - bin/
    - test/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af229-ai-calibration-thinking-2026-11-21.md
    kind: report
  - name: 锚点校准与 thinking 对照报告
    path: data/phase25-exit/af229-ai-calibration-thinking/report.json
    kind: dataset
gates:
  - command: pnpm exec vitest run test/auto-practice/af229-calibration-analysis.spec.ts
    check: 校准与 thinking 对照纯函数用例全绿
    threshold: exit=0
  - command: pnpm lint
    check: lint 0 error / 0 warning
    threshold: exit=0
  - command: pnpm typecheck
    check: typecheck 0 error
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo
    check: CI 同款全量类型检查 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量测试通过
    threshold: exit=0
successCriteria:
  - 使用 R6-D 同批 24 个评测 packet 之外、同一 48 packet 池中的另外 24 个作为留出锚点，三场景各 8 个，不重复使用评测 packet 拟合校准。
  - 对 MiniMax 与豆包禁思考、豆包自动思考三个 arm，分别按总体与五维拟合仿射校准，锚点拟合、评测集独立评估。
  - 报告校准前后总体绝对差、跨模型 κ、exact、within±1、场景方向，并给出锚点留一法 MAE、slope、R2 与稳定性区间。
  - 在同一批评测 packet 上成对比较豆包 thinking disabled 与 auto：模型内 κ、跨模型 κ、绝对差、分数方差/唯一值、reasoning token、截断与解析重试。
  - 预登记 AI 层面判据：校准后总体绝对差不超过 0.3、跨模型 κ 不低于 0.4、五维 within±1 不低于 0.8、场景方向不翻转、锚点留一法 MAE 不超过 0.5 且斜率大于 0。
  - thinking 对照只给 AI 层面建议，不据此声称临床达标；真人双标仍标记为待上线阶段补做。
  - 不修改既有 R6-D 阈值、不放宽证据校验、不合并模型分数、不扩到 48/96/360 线上样本。
  - 定向测试、lint、typecheck、CI 同款 tsc、全量测试全绿；交付记录、回执、归档与受保护 PR 齐全。
---

# AF-229 · R6-D2 AI 层面锚点校准与豆包 thinking 对照

## 背景

AF-227 的 R6-D 2×2 结果显示：跨模型方向一致、within±1 全过，但豆包系统性偏严 0.375，唯一不达项是总体绝对差均值 0.3。用户决定先做 AI 层面达标，真人双标等真实上线阶段再补。

## 范围

1. 从 R6-D 同一 48 packet 池中，取未被 R6-D 使用的 24 个作为留出锚点，拟合 MiniMax 与豆包之间的仿射校准，再在 R6-D 的 24 个评测 packet 上独立评估。
2. 同一批 48 packet 上增加豆包 thinking auto 双臂，与 disabled 成对比较，判断是否值得作为后续默认评分档。
3. 只新增离线评分与分析代码、测试、报告与交付记录，不修改既有阈值、评分提示词和证据校验。

## 非目标

- 不做真人督导师双标或仲裁；不声称临床达标。
- 不扩大线上样本，不改 engine-core/admin-dashboard/Flutter/编排脚本。
