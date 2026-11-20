---
taskId: AF-093
contextId: phase2.5-exit-remediation
title: Phase2.5 出口④质量判定回写 README
type: documentation
status: backlog
baselineRef: f98229fe9e0b21ccb662bf28076686c4d3948e0b
dependsOn:
  - AF-091
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T18:30:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/worklog/pending/
  modules: []
  interfaces: []
artifacts:
  - name: Phase2.5 README
    path: docs/worklog/pending/phase2.5-README.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链与索引投影一致
    threshold: PASS
successCriteria:
  - 在 §3.2 出口条件表回写出口④正式判定：质量未达标 / 部分可判，不冒充通过
  - 写清 96 场历史批次不可重跑、AF-086 12×2 regressed、12 案 496 轮六维覆盖缺口、合成数据不可作验收
  - 记录 AF-091 已交付的临床标注协议与长会话档案，不新跑 LLM 批次
---

# AF-093 · Phase2.5 出口④质量判定回写 README

## 背景

AF-091 已交付出口④临床标注协议与长会话档案，并通过独立验收；README §3.2 仍停留在 AF-088 的
「未通过 / 不可判定」。需要把 AF-091 后的正式判定回写到工作入口，明确“质量未达标”的依据与下一步。

## 范围

只改 `docs/worklog/pending/phase2.5-README.md` 的 §3.2 与新增 §3.2.4；不改代码、不跑 LLM 批次、
不改状态面。

## 非目标

- 不把出口④写成通过
- 不用 `synthetic-supervisor-v1` 的 0.833 冒充 80%
- 不把 96 场历史批次当当前库数据
