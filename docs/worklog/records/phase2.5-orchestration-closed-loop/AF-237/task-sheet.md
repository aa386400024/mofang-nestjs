---
taskId: AF-237
contextId: phase2.5-orchestration-closed-loop
title: Seed Character prompt V2 协作度压制 12 packet 对照
type: implementation
status: backlog
baselineRef: 0b499141e21b80cca68d2c572753810fa68cd1ec
dependsOn: [AF-232, AF-236]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T04:10:00+08:00
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
    path: docs/worklog/completed/phase2.5/af237-seed-character-prompt-v2-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/af232-visitor-shadow.spec.ts
    check: 影子实验单测全绿
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
successCriteria:
  - 新增 seed-v2 prompt 变体与独立 arm，不覆盖 seed-v1 证据。
  - seed-v2 明确压制：向咨询师提问、顺着咨询师措辞/总结、主动提供新事实、突然领悟。
  - 12 packet（4 persona × L1/L2/L3）× A/C/E 三臂生成与双轨评分完成。
  - 报告给出合作指数、回避率、问句轮、平均分与盲评分数，并与 seed-v1 对比给出 conditional/fail 判断。
  - 不接生产，不改生产 visitor 链路。
---

# AF-237 · Seed Character prompt V2 协作度压制 12 packet 对照

## 背景

AF-232 结论：Seed Character 专用 prompt（C 臂）硬门槛全过，但合作指数 `0.236111` 是 MiniMax 基线 A `0.104167` 的 2.27 倍，主要表现为更愿意主动提问、顺着咨询师推进对话。C 臂值得进入 prompt V2，但不能直接接生产。

## 目标

新增 `seed-v2` 约束，在保留 seed-v1 已解决的格式与非法标记问题前提下，压制“太配合、太会推进、太像治疗性对话”的行为。用 12 packet 小样本做 A / C(seed-v1) / E(seed-v2) 三臂对照。

## seed-v2 设计要点

- 不向咨询师提问，包括反问和“你觉得呢”；疑问句一律不出现在台词里。
- 不顺着咨询师的措辞、假设、总结往下接；不以“对/是的/你说得对”开头确认。
- 不主动提供新事实、新回忆、新细节推动对话；同一议题绕圈，每轮只给边缘信息。
- 合作预算：每 3 轮最多 1 轮直接回答核心问题，其余轮次用含糊、回避、沉默或转移。
- 禁止突然领悟、突然深情、一次性交底，禁止总结自己的心理机制。
- 保留 seed-v1 的纯台词、无括号动作、5-40 字、沉默只能“……”或 `[pause:0.5]` 等硬约束。

## 范围

- 只改影子实验 `bin/` 与对应单测，不改生产 `src/agent/visitor/`。
- 新增 arm E `Seed-Character/seed-v2`，保留 A/C 原样。
- 数据产物写 `data/phase25-exit/`，不入库。
- 不接生产、不加 feature flag、不改评分侧双轨模型。

## 验收

- 单测证明 seed-v2 与 seed-v1 分离且新增压制条款存在。
- 三臂生成 36/36 场、评分与报告无 failure。
- 给出 E 是否优于 C 的明确结论；只有合作指数接近 A 且硬门槛全过才判 conditional。
