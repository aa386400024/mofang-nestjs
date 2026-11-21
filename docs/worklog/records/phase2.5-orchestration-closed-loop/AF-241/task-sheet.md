---
taskId: AF-241
contextId: phase2.5-orchestration-closed-loop
title: Seed Character V4 洞察收敛与抽象标签审计
type: implementation
status: backlog
baselineRef: b4f488edc5579ec6767c7a3cae84091d340be66d
dependsOn: [AF-240]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T05:20:00+08:00
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
    path: docs/worklog/completed/phase2.5/af241-seed-v4-insight-2026-11-22.md
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

# AF-241 · Seed Character V4 洞察收敛与抽象标签审计

## 背景

AF-240 发现 V3 把 L3 短句率降下来了，但 L1 盲评反而下降。逐场复核显示 regression 集中在 `vpt_self_worth_intellectualization`：F 说了“不配得感”，随后直接进入“我也想相信自己一次”，形成完整洞察弧；V2 的同场说“不配得感？”随即自嘲“说这个是不是太装了”，更像该人设的理智化防御。问题不是“细节不够”，而是抽象标签一旦出现就滑向治疗性顿悟。

## 目标

1. 新增 `seed-v4`：V2 基础上只加“洞察收敛”约束，允许一次抽象标签尝试，但必须立即收回、自嘲或转移；全场不得出现第二次；禁止完整因果解释和“我意识到/原来我/其实我”弧线。
2. 新增 arm G `Seed-Character/seed-v4`，先跑 1 轮 12 场；与同轮 A/C/E/F 评分比较。若 G 盲评不低于 E 且硬门槛全过，再补 2 轮稳定性。
3. 增加抽象标签计数：统计 `不配得感`、`意识到`、`原来我`、`其实我`、`我值得`、`相信自己`、`创伤`、`依恋`、`防御机制` 等词在 E/F/G 的出现场次，用于解释评分变化。

## 非目标

- 不改 V2 候选状态；V4 只做实验，不接生产。
- 不继续调难度预算；V3 已证明加预算不是瓶颈。
- 不重新生成 A/C/E/F 历史会话，复用 AF-240 r1。

## 验收

- V4 prompt 回归测试覆盖“允许一次抽象词但必须收回”的文案。
- G 臂 12/12 场生成 0 失败；与 A/C/E/F 同轮评分并落 summary。
- 抽象标签审计有场次/臂对照；交付记录写清 G 与 E 的差异和是否进入补轮。
