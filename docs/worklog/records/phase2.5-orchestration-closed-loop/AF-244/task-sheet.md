---
taskId: AF-244
contextId: phase2.5-orchestration-closed-loop
title: V5.1 合法情绪标记枚举与两轮确认
type: implementation
status: backlog
baselineRef: bfdad49dc20580557d3a40ef72c0b5baf7104b96
dependsOn: [AF-243]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T06:10:00+08:00
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
    path: docs/worklog/completed/phase2.5/af244-seed-v51-emotion-tags-2026-11-22.md
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

# AF-244 · V5.1 合法情绪标记枚举与两轮确认

## 背景

AF-243 的 V5（arm H）三轮均优于 V2，但每轮各有 1 条 `[emotion:anxious]` 非法标记，`tag-error-rate=0.006944`。原因是 V5 文案只写“合法语义标记”，没有枚举允许集合；模型在“具体情绪”约束下自然用了 `anxious`。

生产 visitor 若保留非法标记，可能在 TTS 投影或客户端解析处出错。生产前应把 V5 的标签集合写成硬枚举，形成 V5.1。

## 目标

1. 新增 `seed-v51`：在 V5 约束后追加输出标签硬枚举：
   - 允许 `[sigh]` `[breath]` `[laugh]` `[emm]`；
   - 允许 `[pause:x]`；
   - 允许 `[emotion:happy|sad|angry|fearful|disgusted|surprised|calm]`；
   - 其他标签一律不得输出，包括 `[emotion:anxious]`、`[emotion:nervous]`。
2. 新增 arm I `Seed-Character/seed-v51`，先跑 2 轮 12 场；与同轮 E/H 比较。
3. 验收标准：两轮 `tag-error-rate = 0`、硬门槛全过、盲评均值不低于 H 的对应轮次（允许 0.05 内回落），合作指数不高于 H 的对应轮次 + 0.02。

## 非目标

- 不改 V5 的行为约束，只补格式枚举。
- 不做生产路由；生产接入留到后续任务。
- 不因 V5.1 结果好就改主候选；仍需真人双标与生产灰度。

## 验收

- V5.1 prompt 回归覆盖“anxious 不在允许集合”。
- I 臂两轮 24 场 0 失败，`tag-error-rate=0`。
- 交付记录给出 H/I 两轮与 E 的均分、合作、four-rate、硬门槛对照，并明确是否可进入生产接线。
