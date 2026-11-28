---
taskId: AF-606
contextId: phase3-orchestration
title: AF-605 归档台账记录包与交付记录入库收口
type: documentation
status: backlog
riskClass: R0
baselineRef: fe845ffb3b7634fb6f7c7d4971c5bc8b51eb4f9a
dependsOn: [AF-605]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T23:28:44+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/worklog/pending/phase3-orchestration-af606-af605-ledger-record-commit-2026-11-28.md
    - docs/worklog/records/legacy/AF-605/
    - docs/worklog/records/phase3-docs-governance/AF-605/
    - docs/worklog/records/phase3-orchestration/AF-606/
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
  - command: node scripts/orchestration/cli.mjs validate --sheet docs/worklog/records/legacy/AF-606/task-sheet.md
    check: AF-606 任务单契约校验通过；历史 AF-600 / AF-601 / AF-602 schema 缺口不计入本单新增失败
    threshold: AF-606 任务单元 PASS
  - command: pnpm orchestration:preflight
    check: 暂存文件唯一归属 AF-606，且不含状态面生成物或 legacy migrate 遗留改动
    threshold: PASS
successCriteria:
  - AF-605 冻结回执副本、manifest、任务单记录包与交付记录作为本次唯一文档入库范围
  - CLI 状态投影（快照、journal、任务索引、Web data.js）保持未暂存，留待 AF-604 PR 合并后的独立状态同步提交
  - legacy migrate 遗留 manifest 修改、回执删除件与未跟踪 legacy 记录包继续排除，不混入本次提交
  - 不修改 NestJS src、测试、迁移、种子、运行配置；不触碰 Framework 契约与冻结期 PsyGuard
outOfScope:
  - 不合并 AF-604 PR #311，不创建 AF-605 后端合并 PR
  - 不推送 Flutter XS-143 本地提交；推送授权另行确认
  - 不启动 Judge P0 三档主评、judge 可选字段或 provider 选型的功能开发
  - 不清理 AF-600 / AF-601 / AF-602 历史回执 schema 缺口、VPT 哈希漂移、临时脚本或 legacy migrate 遗留
constraints:
  - 状态面只能经 NestJS CLI 写入；本单不手工编辑 task-state-index.json、journal.jsonl、快照或 Web 投影
  - 提交标题遵循 conventional commit；commit-msg 钩子自动补 Task trailer，不使用 --no-verify
  - 跨仓前端提交只在交付记录与 artifactRefs 中引用，不写入本仓 changedFiles.commits
---

# AF-606 · AF-605 归档台账记录包与交付记录入库收口

## 1. 背景

AF-605 已完成回执摄入、验收与归档：后端事件链 verify PASS，AF-605 回执在 validate 中 PASS；前端 XS-143 提交 `760e3182fb23c437e60e5c5e5381a7367b4e7c69` 范围仅限前端编排文档。归档后，AF-605 记录包、manifest、冻结回执副本与交付记录仍留在后端工作区。

当前任务入口闸门只从活跃任务池选择在办任务；已归档的 AF-605 不能继续承接新提交。本单作为台账入库收口任务，承接 AF-605 文档记录的暂存与提交归属，不重写 AF-605 回执、不改写验收结论。

## 2. 执行方式

【执行方式：小豆（编排中枢）直接交付；仅做后端台账文档入库与闸门核对，不承接业务编码】

分流依据：R0 文档治理与编排台账收口；不涉及 Flutter 客户端、NestJS 业务引擎、Framework 规范件或 MiniMax 编码实现。

## 3. 改动清单

| 编号 | 仓库 | 文件 | 动作 |
| --- | --- | --- | --- |
| C1-1 | mofang-nestjs | `docs/worklog/records/legacy/AF-605/` | AF-605 CLI 生成的任务单与记录副本，随台账记录包入库 |
| C1-2 | mofang-nestjs | `docs/worklog/records/phase3-docs-governance/AF-605/` | AF-605 manifest 与冻结回执副本入库 |
| C1-3 | mofang-nestjs | `docs/worklog/completed/phase3-orchestration/af605-frontend-memo-alignment-2026-11-28.md` | AF-605 交付记录入库 |

## 4. 隔离边界

- 状态投影：`orchestration-snapshot.json`、`state/journal.jsonl`、`task-state-index.json`、`web/orchestration/data.js` 不进入本次文档提交；待 AF-604 PR 合并后按独立状态同步口径处理。
- Legacy migrate：约 494 项历史 manifest 修改、6 个 pending/archive 回执删除件与 8 个未跟踪 legacy 记录包目录保持未暂存、未提交。
- 前端仓：XS-143 工件已在前端本地提交；本单只在后端交付记录中引用其 SHA 与路径。

## 5. 闸门口径

1. `events verify`：事件链、schema、哈希链与索引投影一致。
2. `validate`：AF-606 任务单元 PASS；历史 AF-600 / AF-601 / AF-602 回执 schema 缺口属于既有基线，不在本单修复。
3. `orchestration:preflight`：暂存清单唯一归属 AF-606，不含状态面生成物、业务代码或 legacy migrate 遗留。
4. 提交后用 `git show --name-only` 复核实际收录文件，与 §3 清单逐条比对。

## 6. 不做的事

Judge P0 功能开发、AF-604 PR 合并、AF-605 PR 创建、Flutter 提交推送、历史回执 schema 修复与 legacy migrate 清理均不在本单；后续需各自满足任务单登记与授权口径。
