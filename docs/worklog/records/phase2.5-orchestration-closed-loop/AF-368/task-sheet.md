---
contractRef: "urn:agent-collaboration-framework:schema:task-sheet:1.2.0"
taskId: AF-368
contextId: "phase2.5-orchestration-closed-loop"
type: documentation
title: "框架 v2.1.0 发行锚点与契约包来源校准"
status: backlog
baselineRef: "06955ce535be1b2df9bc1571738934ef3960f340"
dependsOn: []
supersedes: []
supersededBy: null
policyRefs: []
createdAt: "2026-11-23T16:10:00+08:00"
objective: "框架 PR #1 已合并并打 v2.1.0 tag，校准适配层版本锚点与契约包来源，消除文档与事实漂移"
successCriteria:
  - "framework-version-anchor.md 记录 v2.1.0 annotated tag 与合并 commit，不再声明候选未打 tag"
  - "PROVENANCE.sourceRef/sourceCommit 指向框架 main 与 v2.1.0 tag commit"
  - "pnpm orchestration:contracts 仍 PASS，15 文件哈希不变"
outOfScope:
  - "不改 schemas 内容"
  - "不改业务代码"
references:
  - ref: "https://github.com/aa386400024/agent-collaboration-framework/pull/1"
    kind: other
    note: "框架 v2.1 PR 已 rebase 合并"
priorTasks:
  - "AF-367"
constraints:
  - "版本锚点是唯一真相源，不复制版本号到 README"
  - "不伪造 tag / commit"
scope:
  files:
    - "contracts/agent-collaboration-framework/2.1.0"
    - "docs/team/agent-orchestration"
    - "docs/worklog"
  modules:
    - "orchestration"
gates:
  - command: "pnpm orchestration:contracts"
    check: "契约包哈希与版本"
    threshold: "PASS 2.1.0"
assertions:
  - "git ls-remote --tags origin v2.1.0 返回 annotated tag object"
risks:
  - "PROVENANCE 变更不得影响 15 个 schema 文件哈希"
agentRole: orchestrator
riskClass: R1
riskRationale: "仅文档与来源元数据校准，无运行时契约内容变化"
gateProfile: standard
artifactRefs:
  others:
    - "https://github.com/aa386400024/agent-collaboration-framework/pull/1"
---

# AF-368 框架 v2.1.0 发行锚点与契约包来源校准

框架 PR #1 已 rebase 合并到 `main`（`e6dd22d`），并打 annotated tag `v2.1.0`（tag object `06045fb`）。本任务只校准 mofang 侧版本锚点与 `PROVENANCE.json`，不修改任何 schema 内容。
