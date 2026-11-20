---
taskId: AF-125
contextId: phase2.5-ai-proxy-acceptance
title: AI 代理跨模型预评审与 AI 层面达标判定
type: verification
status: ready
baselineRef: fc8b9471b8444d3086245ada86c8eea76b230886
dependsOn: [AF-124]
priorTasks: [AF-116]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T09:00:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/worklog/pending/
    - docs/worklog/completed/
    - bin/ai-double-blind.ts
    - src/auto-practice/metrics/ai-double-blind.ts
    - test/auto-practice/ai-double-blind.spec.ts
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af125-ai-proxy-cross-model-2026-11-19.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/ai-double-blind.spec.ts
    check: AI 双盲定向单测全绿
    threshold: 0 failed
successCriteria:
  - 用不同模型版本分别担任 R1/R2，R3 使用独立模型，8 packet 全部有效
  - 给出 AI 层面达标的可复现阈值与判定，不冒充临床验收
  - 若未达标，明确差在一致性、区分度还是证据覆盖，并给出下一次可执行修正
  - 不新跑练习批次，只读既有 AF-109 冻结 long packet
---

# AF-125 · AI 代理跨模型预评审与 AI 层面达标判定

## 背景

AF-116 用同一模型 `MiniMax-M3` 跑 R1/R2/R3，8 packet overall `exact=25% / κ=0`，分数集中在 4–5，不能作为 AI 层面达标证据。当前账号实际可用 `MiniMax-M3`、`MiniMax-M3.1-Flash`、`MiniMax-M2.7` 等模型，具备跨模型评分条件。

## 目标

1. 用跨模型 R1/R2/R3 对同一 8 个 long packet 重跑预评审；
2. 定义并应用 `ai_proxy_pass` 阈值（非临床验收）；
3. 输出 `ai-agreement.json`、`ai-provenance.json`、`ai-report.md` 与正式判定；
4. 未达标时定位到一致性、区分度或证据覆盖，不写“质量达标”。

## 硬边界

- 状态只允许 `ai_proxy_pass` / `ai_proxy_candidate`；`humanSupervision=false`、`clinicalAcceptanceEligible=false` 永不改。
- 不写 `quality_annotation` 人工表，不接 batch-report / CI 硬门。
- 不新跑练习批次；只用 AF-109 批次 `q_35XnpvLWLr-Yocr8kJh` 的既有冻结 packet。
- 密钥只从环境变量读取，不写日志。

## AI 层面达标阈值（提案，按实跑校准）

- 8/8 packet 有效，0 解析失败；
- R1/R2 模型不同（`sameModelForBothRaters=false`）；
- overall `within±1 ≥ 0.875`；
- overall `linearWeightedKappa ≥ 0.40`；
- overall `exact ≥ 0.50`；
- overall 至少出现 2 个不同分值，单一分值占比 ≤ 0.75；
- 所有争议维度均有仲裁，仲裁覆盖率 100%。

未满足任一项即 `ai_proxy_candidate`，不得写达标。

## 输出

交付记录写入 `docs/worklog/completed/phase2.5/af125-ai-proxy-cross-model-2026-11-19.md`；原始评分与 provenance 留在 `$env:TEMP`，不入库。
