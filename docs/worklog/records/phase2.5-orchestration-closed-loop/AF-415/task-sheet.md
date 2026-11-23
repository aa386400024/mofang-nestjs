---
taskId: AF-415
contextId: phase2.5-orchestration-closed-loop
title: A′ 在场判定精确率评估器与分层抽样
type: implementation
status: backlog
baselineRef: 32be0ed0f03e4f27655c6f4823c5a0cbcd74a47d
dependsOn: []
priorTasks: [AF-409, AF-412]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T04:20:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/ops/quality/
    - scripts/orchestration/__tests__/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af415-presence-precision-eval-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/af415-presence-precision-eval.spec.mjs
    check: 抽样与精确率计算单测全绿
    threshold: exit=0
  - command: node scripts/ops/quality/af415-presence-precision-eval.mjs --sample-out .tmp/af415-precision-sample.csv
    check: 抽样表可生成，列只含 sessionId / turnIndex / predicted，不含对话原文
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
successCriteria:
  - 提供确定性分层抽样：每场最多 3 条 holding、2 条非 holding，总上限 40，输出 CSV 只含会话 id / 轮次 / 预测标签 / 空的人工标签列
  - 提供标签评估：读入人工标签 CSV，输出混淆矩阵、precision、recall、F1、accuracy；缺标签或未知标签拒绝计算并给出原因
  - 纯函数可单测，不依赖真实落盘目录；主流程只在显式调用时读 data/debug-sessions
  - 不打印任何咨询师对话原文，不写生产数据，不碰 engine-core
  - lint / typecheck / 定向单测全绿
---

## 背景

AF-409 把在场候选收窄成 A′（结构化或内容词疑问），157 轮 neutral 中命中 117 轮；AF-412 量化了误判的系统代价（100% 误判时整批 safety +0.4660 / bond +0.2320），但精确率始终没有人工标注，无法回答“117 轮里有多少是真在场”。

## 目标

把“人工标注 → 精确率”这条链做成可复现工具：

1. `buildPrecisionSample`：按会话分层抽 holding / 非 holding，确定性、可重复，CSV 只出 `sessionId,turnIndex,predicted,humanLabel` 四列，绝不带对话原文。
2. `evaluatePrecision`：读人工标签，算二分类（holding vs 非 holding）混淆矩阵与 precision / recall / F1 / accuracy，并给逐场分解。
3. CLI：`--sample-out` 生成待标注表；`--labels` 读回标签出报告；两者都只读 `data/debug-sessions`。

## 范围隔离

只新增脚本与单测、交付记录、记录包；不修改 AF-409/408/412 既有脚本行为，不改生产代码，不碰 `src/engine-core`，不提交任何真实对话文本。
