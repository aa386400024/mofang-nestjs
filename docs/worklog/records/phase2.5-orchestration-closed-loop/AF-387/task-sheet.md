---
taskId: AF-387
contextId: phase2.5-orchestration-closed-loop
title: 工作区产物收口验收返修（scope 与交付字段）
type: documentation
status: backlog
baselineRef: 57bcf1cc8012353cc5a362355ea134bcbba61451
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-23T22:15:00+08:00
deadline: null
agentRole: orchestrator
riskClass: R1
riskRationale: 只补文档交付字段与任务 scope 声明，沿用 AF-386 已完成的文件域变更；不触碰源码、CI、数据库与运行配置。
gateProfile: light
objective: 修复 AF-386 机读验收未通过的两项问题：AF-386 记录包 manifest.json 未在 scope 内，以及交付记录未出现六组机读字段标记。
successCriteria:
  - AF-387 任务 scope 覆盖 docs/worklog/records/phase2.5-orchestration-closed-loop/AF-386/ 与 AF-387/
  - 新交付记录包含 gateResults、scopeCheck、contractChecks、backlogItems、deviationTable、reviewVerdict 六组标记
  - AF-386 的 .gitignore、relay-response 证据与 AF-371 移出动作保持原样，不重写历史
  - src、test、bin、engine-core 零改动
outOfScope:
  - 不修改 AF-386 历史状态，不把 rejected 改成 completed
  - 不 force push、不重写 AF-386 提交、不 cherry-pick 改写证据
  - 不提交 data/phase25-exit 原始实验数据与 .tmp 临时产物
references: []
priorTasks:
  - AF-386
constraints:
  - 状态面只能经 CLI 写入
  - 任何提交不得使用 --no-verify
  - 只暂存本任务声明的文件
scope:
  files:
    - .gitignore
    - docs/worklog/pending/archive/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af387-workspace-artifact-cleanup-acceptance-fix-2026-11-23.md
    kind: report
gates:
  - command: git diff --check
    check: 空白与冲突标记检查
    threshold: exit 0
  - command: pnpm orchestration:preflight
    check: 编排前置门通过
    threshold: exit 0
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
  - 新交付记录存在六组英文机读字段标记
  - AF-386 回执中的 manifest.json 路径被 AF-387 scope 覆盖
  - git diff --stat HEAD -- src/engine-core 输出为空
---

## 背景

AF-386 已完成实际收口：`.gitignore` 阻断 `.tmp/`、`data/handoff/`、`data/phase25-exit/`，3 份 relay-response 入库，AF-371 草稿移出 records。但机读验收给出 rejected：AF-386 任务单 scope 未包含登记时自动生成的 `records/.../AF-386/manifest.json`，且交付记录的中文块标题不含六组英文机读字段标记。

本任务按编排规则从 AF-386 HEAD 起 stacked 分支返修：保留 AF-386 历史与提交，不重写、不 cherry-pick；只补 AF-387 scope 声明、新交付记录与回执，使同一文件域变更在 AF-387 下通过验收。
