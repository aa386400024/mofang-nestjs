---
taskId: AF-386
contextId: phase2.5-orchestration-closed-loop
title: 工作区未跟踪产物分类收口
type: documentation
status: backlog
baselineRef: 5ae1cfd4805e6f168b490881727cc60ea5ad43fb
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-23T22:06:42+08:00
deadline: null
agentRole: orchestrator
riskClass: R1
riskRationale: 仅调整 .gitignore 与 docs 归档，删除未登记且已被 AF-372 取代的 AF-371 草稿；不触碰源码、CI、数据库与运行配置。
gateProfile: light
objective: 把当前工作区 26 个未跟踪条目按临时产物、实验数据、文档证据、废弃草稿四类收口，使 Source Control 只保留应入库内容。
successCriteria:
  - .gitignore 阻断 .tmp/、data/handoff/、data/phase25-exit/ 再次进入未跟踪视图
  - 3 份 relay-response-AF357/358/359 作为文档证据入库
  - AF-371 未登记草稿从 records 移除，并由 AF-372 取代关系留痕
  - src、test、bin、engine-core 零改动
outOfScope:
  - 不提交 data/phase25-exit 下的 142 个实验文件与 3.2 MB 原始重复数据
  - 不删除 .tmp/ 本地备份，仅从 Git 跟踪视图排除
  - 不改业务代码、CI、数据库迁移与运行配置
references: []
priorTasks:
  - AF-372
constraints:
  - 状态面只能经 CLI 写入
  - 任何提交不得使用 --no-verify
  - 只暂存本任务声明的文件
scope:
  files:
    - .gitignore
    - docs/worklog/pending/archive/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-371/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af386-workspace-artifact-cleanup-2026-11-23.md
    kind: report
gates:
  - command: git diff --check
    check: 空白与冲突标记检查
    threshold: exit 0
  - command: git status --porcelain
    check: 未跟踪视图只保留任务声明范围
    threshold: 不出现 .tmp/、data/handoff/、data/phase25-exit/
  - command: pnpm orchestration:preflight
    check: 编排前置门通过
    threshold: exit 0
assertions:
  - git check-ignore .tmp/af359-audit/bdi-readiness-audit.json 命中
  - git check-ignore data/handoff/handoff-2026-11-23.md 命中
  - git check-ignore data/phase25-exit/af328-humanization/joblogs.zip 命中
  - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-371 不存在
---

## 背景

当前 integrate 工作树有 26 个未跟踪条目、展开 147 个文件，全部是任务执行过程产物，没有源码改动。其中 `.tmp/` 是临时脚本与备份，`data/phase25-exit/` 是 3.2 MB 实验数据，`data/handoff/` 是 AF-349 时点的过期交接快照；3 份 relay-response 属于已完成的 AF-357/358/359 复审证据；AF-371 是未登记、无事件、且已被 AF-372 覆盖同一修复的草稿。

本任务只做分类收口：临时产物和实验数据保留本地但从 Git 视图排除，复审证据入库，废弃草稿移除，并记录 AF-372 的取代关系。
