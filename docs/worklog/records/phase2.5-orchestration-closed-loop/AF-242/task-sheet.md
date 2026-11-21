---
taskId: AF-242
contextId: phase2.5-orchestration-closed-loop
title: 修复 plot-zero 误判并复评 AF-241 V4 硬门槛
type: fix
status: backlog
baselineRef: 4c0321039132d5e4bc77441e51f23806c43d2d48
dependsOn: [AF-241]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T05:50:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - bin/
    - test/auto-practice/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af242-plot-zero-fix-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/af232-visitor-shadow.spec.ts
    check: 定向单测全绿
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量单测全绿
    threshold: exit=0
---

# AF-242 · 修复 plot-zero 误判并复评 AF-241 V4 硬门槛

## 背景

AF-241 结论记录 G 臂 r2 因 `plot-zero` 硬失败。复核 `data/phase25-exit/af241-seed-v4/*/sessions` 的全部 plot 命中后发现，5 条命中全部是正常口语：

- “她走得很突然，我到现在都没能好好跟她告别。”
- “没什么，就觉得你问得突然，我有点懵。”
- “没什么，就觉得你问得有点突然，我一时不知道怎么答。”

原因是 `PLOT_PATTERNS` 使用未锚定的 `/突然，/`、`/接着，/`、`/于是，/`，任何句中转折词都会命中，属于检测器误报，不是来访者生成了剧本旁白。这会让合法来访者台词被判硬失败，也可能污染 A/C/E/F 历史报告。

## 目标

1. 修正 `PLOT_PATTERNS`：只识别真正的剧本/旁白特征，例如行首括号动作、行首场景/镜头/旁白/画外音/舞台标记，不再匹配句中“突然、接着、于是”。
2. 补回归测试：口语“她走得很突然，……”与“你问得有点突然，……”必须判 0；行首“（低头）……”与“镜头切到窗外。”必须判命中。
3. 用修正后的分析器，对 AF-241 三轮 `r1/r2/r3` 的既有 sessions 与 ratings-cache 重新生成报告，不重新调用生成模型；记录 G/E/A/C/F 硬门槛变化。
4. 按真实结果更新 AF-241 结论口径：如果 G 三轮硬门槛全过，则“V4 r2 硬失败”作废；是否转正仍按盲评、合作指数、four-rate 决定。

## 非目标

- 不改 V2/V4 prompt 文案，不新增 variant，不重跑生成。
- 不改 AF-241 已归档任务单与交付记录正文；修正结论写在 AF-242 记录，并明确指向 AF-241 的失效结论。
- 不重评 AF-237/AF-238/AF-240 历史数据；如有需要，登记后续任务。

## 验收

- plot 检测对 5 条误报全部归零，对真实旁白仍命中。
- AF-241 三轮报告用修正器重算，交付记录给出每轮 G hard 结论与均值差异。
- 结论不夸大：V4 仍不自动转正，主候选状态不变。
