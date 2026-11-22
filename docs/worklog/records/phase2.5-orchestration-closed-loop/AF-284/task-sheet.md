---
taskId: AF-284
contextId: phase2.5-orchestration-closed-loop
title: 扩展 executor 资源域以覆盖部署与运行手册（docker/、docs/runbooks/）
type: implementation
status: backlog
baselineRef: a9cdc4b8afbe2b6ee8ecfb1df238a8adf5764662
dependsOn: []
priorTasks: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-23T15:00:00+08:00"
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/team/agent-orchestration/agent-cards/executor.json
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af284-executor-resource-domain-2026-11-23.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs validate --sheet docs/worklog/records/phase2.5-orchestration-closed-loop/AF-284/task-sheet.md
    check: 任务单 schema 合法
    threshold: exit=0
  - command: node scripts/orchestration/cli.mjs status
    check: 状态面可读且投影一致
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: 输出为空
---
# AF-284 · 扩展 executor 资源域

## 背景

AF-283 需要修改 `docker/prometheus/alerts.yml`、`docker/grafana/dashboards/` 与新增 `docs/runbooks/render-telemetry-alerting.md`，但 executor Agent Card 的 `resources` 只覆盖 `src/`、`bin/`、`test/`、`admin-dashboard/`、`docs/worklog/` 等，调度器按 `scope-domain-conflict` 拒绝派发。

这不是任务写错，而是资源域与 Phase2.5 生产化交付面脱节：渲染遥测的可告警资产天然落在 `docker/` 与 `docs/runbooks/`，继续把这两个目录排除在 executor 域外，会让所有生产化/部署类切片无法派发。

## 目标

1. `executor.json` 的 `resources` 增加 `docker/` 与 `docs/runbooks/`。
2. 保持 `limits.cannotDo` 不变（不新增依赖、不扩大切片、executor 不提交）。
3. 交付记录写明授权依据与影响面：executor 仍只能写任务单 scope 切片，资源域只是“可讨论的边界”，不是全目录写权限。

## 非目标

- 不改 orchestrator card 的其他字段。
- 不放开 `src/engine-core`、Flutter、生产部署执行权限。
- 不改调度器逻辑。

## 验收

- `validate` 通过；`status` 可读；engine-core 零改动。
- AF-283 随后可正常 claim。
