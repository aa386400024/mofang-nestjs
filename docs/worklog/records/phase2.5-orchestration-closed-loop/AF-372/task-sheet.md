---
contractRef: "urn:agent-collaboration-framework:schema:task-sheet:1.2.0"
taskId: AF-372
contextId: "phase2.5-orchestration-closed-loop"
type: fix
title: "风险分级下 coverage 矩阵 check 名称缺失修复"
status: backlog
baselineRef: "9babd9ed0918f652cb63b3e747b4455b96e145c6"
dependsOn: []
supersedes:
  - "AF-371"
supersededBy: null
policyRefs: []
createdAt: "2026-11-23T16:50:00+08:00"
objective: "让 R0/R1 跳过 coverage 时仍产出 Coverage (shard n/3) 与 Coverage Gate 的 required check 状态，避免分支保护永久 pending"
successCriteria:
  - "R1 PR 上 Coverage (shard 1/3..3/3) 与 Coverage Gate 均有 conclusion"
  - "R2 PR 上 coverage 实际执行且 Coverage Gate 阈值生效"
outOfScope:
  - "不改 coverage 阈值"
references: []
priorTasks:
  - "AF-371"
  - "AF-365"
constraints:
  - "R0/R1 不实际跑 coverage 测试，只保留 required check 名称与显式 skipped 说明"
scope:
  files:
    - ".github/workflows/ci.yml"
    - "docs/worklog"
  modules:
    - "ci"
gates:
  - command: "node -e \"const yaml=require('yaml');yaml.parse(require('fs').readFileSync('.github/workflows/ci.yml','utf8'));console.log('yaml ok')\""
    check: "CI YAML 可解析"
    threshold: "yaml ok"
assertions:
  - "coverage-shards 无 job 级 if，真实步骤带 risk 条件"
risks:
  - "coverage job 在 R1 下仍会创建 runner，成本小幅增加"
agentRole: orchestrator
riskClass: R2
riskRationale: "改 CI 受保护上下文，影响所有 PR 的合并门"
gateProfile: full
artifactRefs:
  others: []
---

# AF-372 风险分级下 coverage 矩阵 check 名称缺失

R1/R0 时 `coverage-shards` / `coverage-gate` 因 job 级 `if` 被跳过，矩阵表达式不展开，required 名称 `Coverage (shard n/3)` 永远缺失，PR 无法合并。改为 job 常建、步骤按 risk 条件跳过，并显式打印 skipped 原因；R2 仍全量执行。
