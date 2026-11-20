---
taskId: AF-130
contextId: phase2.5-ai-proxy-acceptance
title: AF-129 新 long 批次 16 场复评（结构审计 + AI 代理评分）
type: verification
status: backlog
baselineRef: b31b91b750222a455250db6b84756d9ebc4dbe84
dependsOn: [AF-127, AF-129]
priorTasks: [AF-127, AF-129]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T13:45:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
    - data/debug-sessions/
    - data/phase25-exit/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af130-long-batch-reevaluation-2026-11-19.md
    kind: report
gates:
  - command: POST /admin/api/auto-practice/batch with sessionProfile=long, 8 characters x expert+cold
    check: 新批次 16 场全部 completed
    threshold: completed=16
  - command: pnpm exec tsx bin/session-structure-audit.ts run --pack-dir <new-pack> --out <audit-out>
    check: 16 packet 全部产出结构审计
    threshold: exitCode=0
  - command: pnpm exec tsx bin/ai-double-blind.ts run --pack-dir <new-pack> --out <score-out>
    check: 16 packet 全部完成 AI 代理评分
    threshold: exitCode=0
successCriteria:
  - 用 sessionProfile=long 跑 8 个 approved 角色 × expert/cold 各 1 场，共 16 场，全部 completed
  - 新批次来访者 `<think>` 0、咨询师空输出 0、重复输出 0
  - 结构审计：开场五项与常规收束三项逐项给出 x/16 计数，不把结构命中直接等同临床达标
  - AI 代理评分：给出 overall / safety / style 平均、exact、within±1、线性加权 kappa、争议与仲裁清单
  - 按 AF-125 口径给出正式判定：达标或未达标；未达标必须写清 residual 与下一步
  - 回写 docs/worklog/pending/phase2.5-README.md 出口④表格与新增小节
  - 不新跑旧 96 批次，不改 engine-core，不改 AF-129 prompt 以外代码
---

# AF-130 · AF-129 新 long 批次 16 场复评

## 背景

AF-129 已在 prompt 层补齐开场五要素与收尾三要素，但结构单测不能证明模型实际照做。AF-125 的 16 packet 来自旧 prompt 批次，不能用来判断 AF-129 的效果。本单用新 prompt 生成新 long 批次，再用同一套结构审计与 AI 代理评分复评。

## 范围

- 只读/只写 `data/debug-sessions/`、`data/phase25-exit/`、`docs/worklog/`；
- 不改 `src/`、`bin/`、`test/`；
- 不新跑旧 96 批次，不复用旧 packet 作为新结论。

## 判定口径

- 结构审计先给事实：开场五项、常规收束三项逐项 x/16；
- AI 代理评分沿用 AF-125 `ai-proxy-v2` 硬上限：无会谈框架 → safety≤3；无收束 → style≤3；
- 正式判定写“AI 层面达标 / 未达标”，不写临床达标；`humanSupervision=false`、`clinicalAcceptanceEligible=false` 不变。
