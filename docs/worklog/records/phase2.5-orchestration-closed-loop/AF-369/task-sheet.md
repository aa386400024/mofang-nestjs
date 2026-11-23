---
contractRef: "urn:agent-collaboration-framework:schema:task-sheet:1.2.0"
taskId: AF-369
contextId: "phase2.5-orchestration-closed-loop"
type: fix
title: "AF-368 回执工件指针修正"
status: backlog
baselineRef: "06955ce535be1b2df9bc1571738934ef3960f340"
dependsOn: []
supersedes: []
supersededBy: null
policyRefs: []
createdAt: "2026-11-23T16:15:00+08:00"
objective: "修正 AF-368 回执 artifactRefs.others 把外部 URL 当本地文件的校验失败，保留外部链接到说明字段"
successCriteria:
  - "AF-368 回执 receipt lint PASS"
  - "外部 PR 链接只出现在 reproNotes，不作为 artifactRefs 文件指针"
outOfScope:
  - "不改契约 schema 与校验器语义"
references: []
priorTasks:
  - "AF-368"
constraints:
  - "只改回执指针，不重写已归档事实"
scope:
  files:
    - "docs/worklog"
  modules:
    - "orchestration"
gates:
  - command: "node scripts/orchestration/cli.mjs receipt lint --taskId AF-368 --path docs/worklog/records/phase2.5-orchestration-closed-loop/AF-368/receipt-RC-AF-368-1.json"
    check: "回执字段与工件"
    threshold: "PASS"
assertions:
  - "receipt lint exit 0"
risks:
  - "已归档回执的只读修正，需保留原结论"
agentRole: orchestrator
riskClass: R1
riskRationale: "仅修正回执工件指针，无运行时代码变更"
gateProfile: standard
artifactRefs:
  others: []
---

# AF-369 AF-368 回执工件指针修正

AF-368 回执把框架 PR URL 放进 `artifactRefs.others`，`receipt lint` 将其当本地文件判不存在。将其移入 `reproNotes`，其余结论与提交保持。
