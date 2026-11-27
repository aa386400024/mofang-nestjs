---
contractRef: "urn:agent-collaboration-framework:schema:task-sheet:1.2.0"
taskId: AF-571
contextId: "phase2.5-audit-remediation"
type: documentation
title: "记录包一致性与 strict worklog 收口"
status: backlog
baselineRef: "a4ca790df11c05c43ec3e8375b577e807c64a889"
dependsOn: []
supersedes: []
supersededBy: null
policyRefs:
  - "docs/team/conventions.md"
  - "docs/team/agent-orchestration/README.md"
createdAt: "2026-11-27T12:20:00+08:00"
objective: "修正 AF-570 回执在提交重写后的 commit 指针可追溯性，并把 7 个既有孤儿记录包逐条登记进继承账，使不带 --state-free 的 worklog verify --strict 也能通过。"
successCriteria:
  - "AF-570 原回执保持不可变，新增 commit-rewrite-map.json 明确旧提交到重写提交及最终 merge SHA 的映射"
  - "AF-570 manifest 的运行态状态与索引终态一致，并指向该映射文件"
  - "AF-512/513/514/515/516/482/497 七个孤儿记录包逐条登记到 legacy-record-packages.json，每条含 reason 与存在的 evidence 文件"
  - "不使用全局 ORCH_STATE_FREE 或 --state-free 跳过孤儿检查"
  - "node scripts/orchestration/cli.mjs worklog verify --strict 退出码 0，继承孤儿计数为 17"
  - "node scripts/orchestration/cli.mjs events verify 通过，src/engine-core 零 diff"
outOfScope:
  - "不改写 AF-570 已提交回执、交付记录或任务单正文"
  - "不改业务代码、测试、migration、配置或运行态"
  - "不把 7 个历史包补写进 journal，也不伪造新事件"
references:
  - ref: "docs/worklog/records/phase2.5-audit-remediation/AF-570/receipt-RC-AF-570-1.json"
    kind: document
    note: "原回执，只读"
  - ref: "docs/team/agent-orchestration/legacy-record-packages.json"
    kind: spec
    note: "历史孤儿记录包继承账"
priorTasks:
  - "AF-570"
constraints:
  - "记录包修订只能新增说明件或更新 manifest 元数据，不覆盖已冻结回执"
  - "继承账只登记有证据、可解释的历史包，不扩成通用跳过机制"
scope:
  files:
    - "docs/worklog/records/phase2.5-audit-remediation/AF-570/"
    - "docs/worklog/records/phase2.5-audit-remediation/AF-571/"
    - "docs/team/agent-orchestration/legacy-record-packages.json"
    - "docs/worklog/completed/phase2.5/"
  modules: []
  interfaces: []
exclusions:
  - "src/"
  - "test/"
  - "scripts/"
  - "admin-dashboard/"
  - "docs/team/agent-orchestration/state/"
requiredSkills:
  - "orchestration"
requiredTools:
  - "workspace-write"
agentRole: orchestrator
artifacts:
  - name: "交付记录"
    path: "docs/worklog/completed/phase2.5/af571-record-package-consistency-2026-11-27.md"
    kind: report
artifactSchema: null
deliveryPath: null
gates:
  - command: "node scripts/orchestration/cli.mjs worklog verify --strict"
    check: "strict 记录包校验通过"
    threshold: "exit 0"
  - command: "node scripts/orchestration/cli.mjs events verify"
    check: "事件链与索引投影一致"
    threshold: "exit 0"
  - command: "git diff --stat HEAD -- src/engine-core"
    check: "engine-core 零 diff"
    threshold: "输出为空"
evidenceFormat: "命令 + 退出码 + 关键计数"
riskClass: R0
riskRationale: "仅修订记录包元数据与继承账，无运行时、业务或状态机逻辑变化"
gateProfile: light
escalationTriggers:
  - "strict 校验仍出现清单外孤儿"
  - "需要改写已冻结回执才能通过"
priority: null
deadline: null
retention: null
---

# AF-571 · 记录包一致性与 strict worklog 收口

AF-570 已合并，但回执中的 `changedFiles.commits` 仍指向重写前的 `e003bf5f`；该提交已不在 `integrate` 上。原回执不可原地改写，因此新增一份可机读的提交重写映射，保留原证据并恢复可追溯性。

同时，`worklog verify --strict`（不带 `--state-free`）仍报 7 个既有孤儿记录包：AF-512/513/514/515/516/482/497。它们有 manifest、任务单、部分回执或交付记录，但缺 journal 事件。按仓库既有机制，逐条登记到 `legacy-record-packages.json`，而不是用全局 `--state-free` 跳过。

## 不在范围

- 不改 AF-570 原回执、任务单、交付记录。
- 不补写 journal 事件，不伪造历史状态。
- 不碰业务代码、测试、migration、配置或运行态。
