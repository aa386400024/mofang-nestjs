---
taskId: AF-609
contextId: phase3-orchestration
title: 调整主会话回收口径：执行方验收后，主会话只做台账登记与元数据核对
type: documentation
status: backlog
riskClass: R0
baselineRef: b3388ab8daa58f68fcf8afe4e5fe1861b305944a
dependsOn: [AF-608]
priorTasks: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T23:41:09+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/worklog/pending/phase3-orchestration-af609-orchestrator-intake-scope-2026-11-28.md
    - docs/worklog/records/phase3-orchestration/AF-609/
    - docs/team/agent-orchestration/collaboration-workflow.md
    - docs/worklog/completed/phase3-orchestration/af609-orchestrator-intake-scope-2026-11-28.md
  modules: []
  interfaces: []
artifacts:
  - name: AF-609 协作口径调整交付记录
    path: docs/worklog/completed/phase3-orchestration/af609-orchestrator-intake-scope-2026-11-28.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs events verify
    check: 后端事件链、哈希链与索引投影一致
    threshold: PASS
  - command: node scripts/orchestration/cli.mjs validate --sheet docs/worklog/records/phase3-orchestration/AF-609/task-sheet.md
    check: AF-609 任务单契约校验通过；历史 AF-600 / AF-601 / AF-602 schema 缺口不计入本单新增失败
    threshold: AF-609 任务单元 PASS
  - command: pnpm orchestration:preflight
    check: 暂存文件唯一归属 AF-609，且不含状态面生成物、业务代码或 legacy migrate 遗留改动
    threshold: PASS
successCriteria:
  - 后端协作备忘明确：Flutter / NestJS / MiniMax 执行方已完成闸门与自验收后，主会话不重复跑测试、lint、typecheck、analyze 或业务验收
  - 主会话回收动作限定为回执与交付记录存在性、verdict / scope / 遗留字段、工件路径、跨仓引用和台账状态的元数据核对
  - 编排 CLI 的事件链、归档状态与台账计数仍作为状态面一致性检查；这不是对执行方业务结果的重复验收
  - 本地小豆侧验收 / 执行器技能同步改为台账回收口径，避免会话间重复验收
  - 不修改 NestJS src、测试、迁移、种子、运行配置；不触碰 Framework 契约与冻结期 PsyGuard
outOfScope:
  - 不合并 AF-604 PR #311，不创建后端台账合并 PR
  - 不推送 Flutter XS-143 本地提交；推送授权另行确认
  - 不启动 Judge P0 三档主评、judge 可选字段或 provider 选型的功能开发
  - 不清理 AF-600 / AF-601 / AF-602 历史回执 schema 缺口、VPT 哈希漂移、临时脚本或 legacy migrate 遗留
constraints:
  - 状态面只能经 NestJS CLI 写入；本单不手工编辑 task-state-index.json、journal.jsonl、快照或 Web 投影
  - 提交标题遵循 conventional commit；commit-msg 钩子自动补 Task trailer，不使用 --no-verify
  - 跨仓前端文档口径如需同步，另按前端仓任务流程处理；本单不把前端提交写入后端 changedFiles.commits
---

# AF-609 · 调整主会话回收口径：执行方验收后，主会话只做台账登记与元数据核对

## 1. 背景

既有协作备忘与小豆侧验收技能要求主会话在执行方回交后再次核对闸门证据、抽跑关键路径，并据此给出通过 / 有条件通过 / 打回结论。当前 Flutter 置顶会话、NestJS 置顶会话与 MiniMax Code 执行链路已在各自任务内完成闸门运行、scope 自检和回执产出；主会话重复执行同类验收会拉长闭环时间，也容易造成两套验收口径。

本单只调整回收分工：执行方对业务实现、闸门结果和自验收结论负责；主会话负责任务定型、派发、回执台账登记、元数据一致性核对、阻塞与遗留跟踪。状态面 CLI 检查仍保留，用于确认台账事件链和归档状态真实一致，不作为业务代码验收复跑。

## 2. 执行方式

【执行方式：小豆（编排中枢）直接交付；仅做协作文档与本地技能口径调整，不承接业务编码】

分流依据：R0 文档治理与编排口径调整；不涉及 Flutter 客户端、NestJS 业务引擎、Framework 契约或 MiniMax 编码实现。

## 3. 改动清单

| 编号 | 仓库 / 位置 | 文件 | 动作 |
| --- | --- | --- | --- |
| R1-1 | mofang-nestjs | `docs/team/agent-orchestration/collaboration-workflow.md` | 将“主会话验收”改为“执行方自验收 + 主会话台账回收”，明确不重复跑业务闸门 |
| R1-2 | 小豆本地技能 | `ai-handoff-acceptance/SKILL.md` 与 `references/acceptance-checklist.md` | 从重复验收清单改为回执、工件、scope 元数据与台账状态回收清单 |
| R1-3 | 小豆本地技能 | `xinsu-task-executor/SKILL.md` | 回执交回步骤改为主会话台账登记与元数据核对，不再要求主会话复核执行方闸门结果 |
| R1-4 | mofang-nestjs | `docs/worklog/completed/phase3-orchestration/af609-orchestrator-intake-scope-2026-11-28.md` | 记录本单改动、闸门证据、隔离边界与后续口径 |

## 4. 回收边界

### 4.1 执行方负责

- 任务 scope 内的实现、测试、lint、typecheck / analyze、提交与回执材料。
- 闸门命令、退出码、错误 / 警告 / 用例数、失败项归因和偏差记录。
- 回执 `reviewVerdict`、`scopeCheck`、`contractChecks`、`backlogItems`、`deviationTable` 等字段自洽。

### 4.2 主会话负责

- 回执、交付记录和工件路径是否回流到指定台账位置。
- 回执 verdict、scope、依赖、遗留项、偏差和跨仓引用是否与任务单口径一致。
- 台账状态是否经 CLI 归档；事件链、归档计数和任务索引是否一致。
- 发现字段缺失、工件路径不一致、越界引用或台账状态异常时，退回执行方补正；不替代执行方重跑业务验收。

## 5. 闸门口径

1. `events verify`：确认编排事件 schema、哈希链与索引投影一致。
2. `validate`：AF-609 任务单元 PASS；历史 AF-600 / AF-601 / AF-602 回执 schema 缺口属于既有基线，不在本单修复。
3. `orchestration:preflight`：暂存清单唯一归属 AF-609，不含状态面生成物、业务代码或 legacy migrate 遗留。
4. 提交后用 `git show --name-only` 复核实际收录文件，与 §3 后端仓清单逐条比对。

## 6. 不做的事

Judge P0 功能开发、AF-604 PR 合并、后端台账 PR 创建、Flutter 提交推送、历史回执 schema 修复与 legacy migrate 清理均不在本单；后续需各自满足任务单登记与授权口径。
