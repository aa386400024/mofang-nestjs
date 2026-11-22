---
taskId: AF-243
contextId: phase2.5-orchestration-closed-loop
title: Seed Character V5 接触防御与具体情绪
type: implementation
status: backlog
baselineRef: 843c7a899ae85f5154bd96f1cf65cdbac9c03b0c
dependsOn: [AF-242]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T06:00:00+08:00
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
    path: docs/worklog/completed/phase2.5/af243-seed-v5-contact-defense-2026-11-22.md
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

# AF-243 · Seed Character V5 接触防御与具体情绪

## 背景

AF-242 修正 plot 误判后，V4（arm G）三轮硬门槛 3/3 全过，盲评均值 3.868687，只比 V2（E）的 3.888889 低 0.020202；合作指数 0.083333 低于 E 的 0.099537。逐维看，G 的自然度、情绪连续、话轮形态都不低于 E，唯一明显低的是关系在场（r3 3.727 vs E 4.0）。

这说明 V4 的问题不是“像不像来访者”，而是“太封闭、不回接咨询师这个人”。V4 禁止把假设接成自我总结，但也把正常的人际反应一起压掉了。

## 目标

1. 新增 `seed-v5`：在 V4 的洞察抑制基础上，去掉“允许一次抽象词”，改为“零抽象标签 + 接触防御”。
2. 接触防御：每 2 轮至少 1 轮回应咨询师这句话给来访者的即时反应（身体、态度、动作），但不确认对方的假设、不接成自我总结。例：“你这么一问，我有点烦。”“你刚才说慢慢来，我反倒更想快点说完。”“你别老盯着我，我不习惯。”
3. 具体情绪：不写“不配得感/回避/依恋/防御/创伤/投射/边界/自我价值/内在小孩”，只写具体感受或行为（胸口闷、手心出汗、想抽烟、想笑、脑子空白）。
4. 不新增重大事实、不推进剧情、不设计治疗性弧线；可以重复同一个具体细节，像真人卡住。
5. 新增 arm H `Seed-Character/seed-v5`，先跑 2 轮 12 场；只有两轮都满足“硬门槛全过、盲评均值不低于 E、合作指数不高于 E”才补第 3 轮。

## 非目标

- 不改评分模型与双轨口径，不做 Lite→M3.1 仿射映射。
- 不接生产，不改 seed-v2 主候选状态。
- 不重评 AF-237/AF-238/AF-240 历史报告。
- 不因为 H 单轮好看就晋级；至少两轮。

## 验收

- `seed-v5` prompt 回归覆盖“零抽象标签、接触防御、具体情绪”三条。
- H 臂 12/12 场生成 0 失败，两轮均有完整 report/summary。
- 交付记录给出 H/E/G 两轮盲评、合作指数、L1/L3、four-rate、硬门槛对照，并明确是否补第三轮。
