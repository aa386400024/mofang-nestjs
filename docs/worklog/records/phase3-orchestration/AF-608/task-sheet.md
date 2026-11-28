---
taskId: AF-608
contextId: phase3-orchestration
title: AF-606 台账收口返修：补齐回执副本与记录包 scope 覆盖
type: documentation
status: backlog
riskClass: R0
baselineRef: 4b084db2766aebfae86810c40ff6138030939406
dependsOn: [AF-605]
priorTasks: [AF-606]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T23:37:10+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/worklog/pending/phase3-orchestration-af608-af606-receipt-scope-rework-2026-11-28.md
    - docs/worklog/records/legacy/AF-605/
    - docs/worklog/records/phase3-docs-governance/AF-605/
    - docs/worklog/records/phase3-orchestration/AF-606/
    - docs/worklog/records/phase3-orchestration/AF-608/
    - docs/worklog/completed/phase3-orchestration/af605-frontend-memo-alignment-2026-11-28.md
  modules: []
  interfaces: []
artifacts:
  - name: AF-605 台账入库交付记录
    path: docs/worklog/completed/phase3-orchestration/af605-frontend-memo-alignment-2026-11-28.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs events verify
    check: 后端事件链、哈希链与索引投影一致
    threshold: PASS
  - command: node scripts/orchestration/cli.mjs validate --sheet docs/worklog/records/legacy/AF-608/task-sheet.md
    check: AF-608 任务单契约校验通过；历史 AF-600 / AF-601 / AF-602 schema 缺口不计入本单新增失败
    threshold: AF-608 任务单元 PASS
  - command: pnpm orchestration:preflight
    check: 暂存文件唯一归属 AF-608，且不含状态面生成物或 legacy migrate 遗留改动
    threshold: PASS
successCriteria:
  - AF-606 冻结回执副本随本次返修提交入库；AF-608 自身 manifest、任务单与冻结回执副本进入对应记录包
  - 回执 changedFiles 与任务 scope 覆盖 AF-606 / AF-608 记录包目录，V7 文件域残留复核不再把任务记录包文件判为 scope 外
  - AF-605 交付记录补齐本次返修提交指针、AF-606 被验收打回的客观原因，以及 backlogItems / deviationTable 字段标记
  - CLI 状态投影（快照、journal、任务索引、Web data.js）保持未暂存，留待 AF-604 PR 合并后的独立状态同步提交
  - legacy migrate 遗留 manifest 修改、回执删除件与未跟踪 legacy 记录包继续排除，不混入本次提交
  - 不修改 NestJS src、测试、迁移、种子、运行配置；不触碰 Framework 契约与冻结期 PsyGuard
outOfScope:
  - 不合并 AF-604 PR #311，不创建 AF-605 / AF-606 / AF-608 后端合并 PR
  - 不推送 Flutter XS-143 本地提交；推送授权另行确认
  - 不启动 Judge P0 三档主评、judge 可选字段或 provider 选型的功能开发
  - 不清理 AF-600 / AF-601 / AF-602 历史回执 schema 缺口、VPT 哈希漂移、临时脚本或 legacy migrate 遗留
constraints:
  - 状态面只能经 NestJS CLI 写入；本单不手工编辑 task-state-index.json、journal.jsonl、快照或 Web 投影
  - 提交标题遵循 conventional commit；commit-msg 钩子自动补 Task trailer，不使用 --no-verify
  - 跨仓前端提交只在交付记录与 artifactRefs 中引用，不写入本仓 changedFiles.commits
---

# AF-608 · AF-606 台账收口返修：补齐回执副本与记录包 scope 覆盖

## 1. 背景

AF-606 首个收口提交 `4b084db2` 已入库 AF-605 台账记录包、交付记录以及 AF-606 manifest / 任务单。回执摄入后，机读验收在 V7 文件域残留检查中判定：提交内的 `docs/worklog/records/phase3-orchestration/AF-606/manifest.json` 未被任务 scope 覆盖；AF-606 因此归档为 rejected，并生成返修提案 RW-AF-606-1。

AF-607 因把 rejected 的 AF-606 写入 `dependsOn` 被提级闸门拒绝，已取消；本单将 AF-605 作为已完成依赖，AF-606 只作为 `priorTasks` 返修来源。本单不重写 AF-605 / AF-606 已冻结回执结论，不修复历史遗留；只把 AF-606 回执副本与 AF-608 自身记录包纳入正确 scope，完成剩余台账入库。

## 2. 执行方式

【执行方式：小豆（编排中枢）直接交付；仅做后端台账文档入库与闸门核对，不承接业务编码】

分流依据：R0 文档治理与编排台账返修；不涉及 Flutter 客户端、NestJS 业务引擎、Framework 规范件或 MiniMax 编码实现。

## 3. 改动清单

| 编号 | 仓库 | 文件 | 动作 |
| --- | --- | --- | --- |
| R1-1 | mofang-nestjs | `docs/worklog/records/phase3-orchestration/AF-606/` | 提交 AF-606 冻结回执副本；manifest 与任务单已在 `4b084db2` 入库，本单不重复提交 |
| R1-2 | mofang-nestjs | `docs/worklog/records/phase3-orchestration/AF-608/` | AF-608 manifest、任务单与冻结回执副本记录包 |
| R1-3 | mofang-nestjs | `docs/worklog/completed/phase3-orchestration/af605-frontend-memo-alignment-2026-11-28.md` | 补齐返修提交指针、AF-606 验收打回原因与回执字段标记 |
| R1-4 | mofang-nestjs | `docs/worklog/records/legacy/AF-605/`、`docs/worklog/records/phase3-docs-governance/AF-605/` | 保留 AF-605 既有台账切片 scope 覆盖；文件已在 `4b084db2` 入库，本单不重复声明为新增改动 |

## 4. 隔离边界

- 状态投影：`orchestration-snapshot.json`、`state/journal.jsonl`、`task-state-index.json`、`web/orchestration/data.js` 不进入本次文档提交；待 AF-604 PR 合并后按独立状态同步口径处理。
- Legacy migrate：约 494 项历史 manifest 修改、6 个 pending / archive 回执删除件与 8 个未跟踪 legacy 记录包目录保持未暂存、未提交。
- 前端仓：XS-143 工件已在前端本地提交；本单只在后端交付记录中引用其 SHA 与路径。

## 5. 闸门口径

1. `events verify`：事件链、schema、哈希链与索引投影一致。
2. `validate`：AF-608 任务单元 PASS；历史 AF-600 / AF-601 / AF-602 回执 schema 缺口属于既有基线，不在本单修复。
3. `orchestration:preflight`：暂存清单唯一归属 AF-608，不含状态面生成物、业务代码或 legacy migrate 遗留。
4. 提交后用 `git show --name-only` 复核实际收录文件，与 §3 清单逐条比对。

## 6. 不做的事

Judge P0 功能开发、AF-604 PR 合并、后端台账 PR 创建、Flutter 提交推送、历史回执 schema 修复与 legacy migrate 清理均不在本单；后续需各自满足任务单登记与授权口径。
