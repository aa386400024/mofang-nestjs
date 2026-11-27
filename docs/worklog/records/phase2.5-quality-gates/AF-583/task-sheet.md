---
taskId: AF-583
contextId: phase2.5-quality-gates
title: 关闭 IM-058：咨询师降级比例消费已由 AF-581 落地
type: documentation
status: backlog
baselineRef: ac4724c63a41a1f828f94d95b5b01a60927f4813
dependsOn: []
priorTasks: [AF-581]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T00:40:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/team/agent-orchestration/improvement-log.json
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-quality-gates/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af583-close-im058-2026-11-28.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs improvements --summary
    check: IM-058 进入 done，活跃数从 8 降到 7
    threshold: exit 0
  - command: node scripts/orchestration/cli.mjs validate
    check: 全仓机读校验 PASS
    threshold: exit 0
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链与索引投影一致
    threshold: exit 0
successCriteria:
  - IM-058 状态由 accepted 流转为 done，linkedTask=AF-581
  - note 写明 AF-581 的 counselorDegradedRatio 与 COUNSELOR_DEGRADED_HIGH 证据
  - 只改台账与交付记录，不改代码、测试或运行态配置
  - 台账活跃数从 8 降到 7，总 85 不变
objective: 把已由 AF-581 落地的 IM-058 从活跃改进台账关闭，消除台账与现实漂移
outOfScope:
  - 不关闭其余 7 条活跃改进
  - 不调整 IM-058 的 title / type / layer 等原始字段
constraints:
  - 只能经 improvements --transition 改状态，不手改 JSON
  - linkedTask 必须写 AF-581，note 必须可复核
---

## 背景

AF-580 清理台账时保留 IM-058 活跃，理由是 `computeBatchMetrics` 已聚合 `counselorDegradedTurns` 但 `evaluateBatchHealth` 未消费。AF-581 已补 `counselorDegradedRatio` 与 `COUNSELOR_DEGRADED_HIGH` 门禁，定向 29 例与全量 5153 例通过，PR #293 合并 SHA `db586a05db0f68d0c092628ee73585f8f5e9d63f`。IM-058 已具备关闭证据。

## 实现口径

1. `improvements --transition IM-058 done --linked-task AF-581 --note <证据>`。
2. 交付记录写清 AF-581 的字段、flag、阈值、测试与合并 SHA。
3. 不改任何代码或运行态配置。

## 红线

- 不手改 `improvement-log.json`。
- 不批量关闭其他活跃条目。
- 状态面与实现分离提交。
