---
taskId: AF-580
contextId: phase2.5-orchestration-closed-loop
title: 清理改进台账中已由后续任务落地或已决策关闭的历史条目
type: documentation
status: backlog
baselineRef: ba156c61d060b55f2925337d56405e139dd42ba4
dependsOn: []
priorTasks: [AF-579]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-27T20:20:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/team/agent-orchestration/improvement-log.json
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af580-improvement-ledger-cleanup-2026-11-27.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs improvements --summary
    check: 活跃条目下降且全部保留项都有明确未完成原因
    threshold: exit 0
  - command: node scripts/orchestration/cli.mjs worklog verify --strict --state-free
    check: 记录包与台账结构一致
    threshold: exit 0
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链与索引投影一致
    threshold: exit 0
  - command: node scripts/orchestration/cli.mjs validate
    check: 全仓机读校验全 PASS
    threshold: exit 0
successCriteria:
  - 只关闭已由后续任务真实落地、或已有明确决策不再做的条目；每条给出 linkedTask 与证据 note
  - 仍无落地证据的条目保持 candidate / queued，不用台账数字凑「清零」
  - 台账变更全部经 CLI improvements --transition 写入，不手改 improvement-log.json
  - 交付记录列出关闭清单、保留清单与判定依据
  - 不修改 AF-579 代码、框架契约、engine-core 与业务代码
objective: 让改进台账回到可信状态：已落地的关掉并留下追溯，未落地的继续跟踪，避免同一问题反复被重新提出
outOfScope:
  - 不实现任何改进项本身
  - 不关闭 IM-073（临床真人双标阻塞）与仍需新语料/新批次验证的条目
  - 不改 scripts/orchestration 代码与框架 schema
constraints:
  - 台账是状态面，只能经 CLI 流转
  - 每条关闭必须能指到具体交付记录或当前仓库事实
  - 不把「已有候选」误判成「已解决」
---

## 背景

台账当前有 26 条非终态条目，其中多条实际已被后续任务落地（AF-102/AF-103/AF-129/AF-140/AF-147 等），但仍停在 candidate；也有条目属于已决策的保守口径或运行环境约束。需要一次有证据的清理，而不是把数字清成 0。

## 判定口径

- `done`：后续任务已实现该条建议，当前仓库可核实；写 linkedTask 与证据 note。
- `wontfix`：已有明确决策不再做，或条目属于环境约束而非仓库缺陷；写理由。
- 保留：没有真实落地证据，或仍需新批次 / 真人资源。

## 验收

1. `improvements --summary` 活跃数下降，保留项逐条有原因。
2. 所有流转经 CLI，`worklog verify --strict` 与 `events verify` PASS。
3. 交付记录给出关闭/保留清单与证据。
