---
contractRef: "urn:agent-collaboration-framework:schema:task-sheet:1.2.0"
taskId: AF-370
contextId: "phase2.5-orchestration-closed-loop"
type: documentation
title: "合并后状态面收口：回执哈希迁移与孤儿记录包补登"
status: backlog
baselineRef: "9babd9ed0918f652cb63b3e747b4455b96e145c6"
dependsOn: []
supersedes: []
supersededBy: null
policyRefs: []
createdAt: "2026-11-23T16:30:00+08:00"
objective: "修复 integrate 合并后 worklog strict 的回执哈希漂移与 AF-363/364 孤儿记录包"
successCriteria:
  - "worklog verify --strict PASS"
  - "events verify PASS"
  - "AF-368 回执哈希经 worklog migrate 重新入 manifest"
outOfScope:
  - "不改业务代码与框架契约"
references: []
priorTasks:
  - "AF-365"
constraints:
  - "只经 CLI 迁移工作日志与补登事件，不手改索引"
scope:
  files:
    - "docs/worklog"
  modules:
    - "orchestration"
gates:
  - command: "node scripts/orchestration/cli.mjs worklog verify --strict"
    check: "工作日志完整性"
    threshold: "PASS"
assertions:
  - "worklog strict exit 0"
risks:
  - "补登事件会新增状态面记录，需注明历史取消原因"
agentRole: orchestrator
riskClass: R1
riskRationale: "仅工作日志与状态面迁移，无运行时代码"
gateProfile: standard
artifactRefs:
  others: []
---

# AF-370 合并后状态面收口

integrate 合入后本地状态面由 CLI 恢复；AF-368 回执在 AF-369 修正后哈希漂移；AF-363/364 记录包未在索引归档。经 `worklog migrate --apply`、`events create/cancel/archive` 补齐。
