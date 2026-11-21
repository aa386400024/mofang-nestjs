---
taskId: AF-238
contextId: phase2.5-orchestration-closed-loop
title: seed-v2 三采样稳定性复核
type: implementation
status: backlog
baselineRef: 1788df71f7d206430ab4dbeb1ecb559707f0c7e2
dependsOn: [AF-237]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T04:32:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af238-seed-v2-stability-2026-11-22.md
    kind: report
gates:
  - command: pnpm orchestration:worklog:verify
    check: 记录闭环完整
    threshold: exit=0
successCriteria:
  - 对同一 12 packet 矩阵额外生成 2 轮 C/E 会话，每臂累计 3 个采样。
  - 三轮独立评分，给出 C/E 均分、合作指数、回避率、提问率、4 分占比的 run-to-run 变化。
  - 给出 seed-v2 是否稳定的明确判断：合作指数是否稳定低于 0.12、硬门槛是否三轮全过。
  - 不接生产、不改代码、不改评分模型。
---

# AF-238 · seed-v2 三采样稳定性复核

## 背景

AF-237 的 12 packet 对照显示 seed-v2 把合作指数从 `0.243056` 压到 `0.097222`，盲评均分 `3.875`，硬门槛全过。但单次采样不足以判断稳定性，且 E 在 L1/L3 存在难度偏移迹象。

## 目标

对同一 4 persona × L1/L2/L3 矩阵，为 C（seed-v1）与 E（seed-v2）各追加 2 轮生成，共 3 个采样 × 2 臂，分别评分，观察合作指数与均分的 run-to-run 波动。

## 范围

- 只跑离线实验与写交付记录；不改 `bin/`、`src/`、`test/`。
- 复用 A 臂不变内容作为基线；C/E 每轮重新生成。
- 产物在 `data/phase25-exit/af238-seed-v2-stability/`，不入库。

## 验收

- C/E 各 3 轮 × 12 场；每轮 0 失败。
- 给出逐轮表与均值 ± 极差；若 E 的合作指数三轮均 ≤ 0.12 且硬门槛全过，判稳定；否则指出不稳定维度。
