---
taskId: AF-385
contextId: phase2.5-orchestration-closed-loop
title: 编排状态面同步与取消任务记录补齐
type: fix
status: backlog
baselineRef: 813c4cc93be88aff94a567e974378af167c2fb13
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-23T20:57:00+08:00
deadline: null
agentRole: orchestrator
riskClass: R1
riskRationale: 只同步编排状态面投影并补齐取消任务记录包，不改业务代码、CI 与运行逻辑。
gateProfile: full
objective: 把 AF-384 归档后的状态面投影提交到 integrate，补齐 AF-379/AF-380/AF-381 取消记录包，并移除 AF-382 的 legacy 重复副本，使远端索引与事件链一致。
successCriteria:
  - 远端 integrate 的 task-state-index.json 含 AF-384 completed、AF-379/AF-380/AF-381 canceled
  - events verify 通过且哈希链与索引投影一致
  - AF-379/AF-380/AF-381 任务单与 manifest 进入 records，legacy/AF-382 重复副本移除
  - src/engine-core 无任何改动
outOfScope:
  - 不改业务代码、engine-core、migration、CI workflow
  - 不改已完成任务的交付记录与回执内容
  - 不重放 AF-363..AF-372、AF-376 的历史归档事件
  - 不处理 data/ 下的本地评测证据与 .tmp/ 临时文件
references: []
priorTasks:
  - AF-384
  - AF-383
constraints:
  - 状态面只能经 CLI 写入
  - 不手工修改 task-state-index.json
  - 回执先 freeze 再 run-once
  - 任何提交不得使用 --no-verify
scope:
  files:
    - docs/team/agent-orchestration/
    - docs/worklog/records/
    - docs/worklog/completed/phase2.5/
    - web/orchestration/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af385-orchestration-state-sync-2026-11-23.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链与索引投影一致
    threshold: PASS，哈希链一致
  - command: pnpm lint
    check: ESLint 全绿
    threshold: exit 0
  - command: pnpm typecheck
    check: TypeScript 全量类型检查通过
    threshold: exit 0
  - command: pnpm test
    check: 全量单测通过
    threshold: exit 0，0 failed
assertions:
  - git diff --stat HEAD -- src/engine-core 为空
  - 远端 task-state-index.json 中 AF-384 status=completed
---

## 背景

AF-384 的修复提交与回执已通过 PR #187 合入 integrate（mergeSha 813c4cc93be88aff94a567e974378af167c2fb13），但 run-once 在回执提交之后才执行，归档产生的状态面投影未进入 PR HEAD。远端 task-state-index.json 因此仍看不到 AF-384。

同时 AF-379/AF-380/AF-381 的取消记录包只存在于工作树，索引已指向这些路径；AF-382 另有一份 legacy 重复副本。本任务只做状态面与记录包收口。

## 范围

- 提交 CLI 生成的 task-state-index、journal、snapshot、archived-notes 与 web/orchestration/data.js。
- 提交 AF-379/AF-380/AF-381 的 task-sheet 与 manifest。
- 删除 docs/worklog/records/legacy/AF-382 重复副本，保留 canonical 记录包。
- 写交付记录，冻结回执。

## 验收

- events verify PASS。
- 远端索引可查到 AF-384 completed 与三个取消任务。
- src/engine-core 零 diff。
