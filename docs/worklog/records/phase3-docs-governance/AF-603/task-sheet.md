---
taskId: AF-603
contextId: phase3-docs-governance
title: 补齐五仓协作规范文档缺口（协调仓索引、PsyGuard 指令、Framework 锚点与变更记录）
type: documentation
status: backlog
riskClass: R0
baselineRef: 68cdd6c33800d032ba9755d0fba3bc7aba679834
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T22:03:38+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/worklog/pending/
    - docs/worklog/records/phase3-docs-governance/
    - docs/worklog/completed/phase3-orchestration/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase3-orchestration/af603-docs-governance-gap-closure-2026-11-28.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链与索引投影一致
    threshold: PASS
  - command: python conformance/run.py
    check: Framework 契约面自洽、样例合规、锚点短语在场
    threshold: 退出码 0
  - command: python -m unittest discover -s tests
    check: 协调仓 CLI 与流程单测全绿
    threshold: 退出码 0
  - command: python cli.py validate
    check: 协调仓工件校验（既有 VPT 报告合同哈希漂移属旧战线，不在本单范围）
    threshold: 除既有漂移外无新增失败
successCriteria:
  - 协调仓 README 补目录职责表（config / contracts / features / runtime / templates / tests）与 CLI 子命令速查，命令均以仓库根目录 `python cli.py <sub>` 为口径
  - 协调仓 README 补两份会话分工备忘的反向指针：后端 `../backend/mofang-nestjs-af070/docs/team/agent-orchestration/collaboration-workflow.md`、前端 `../frontend/xin_su_app/docs/team/agent-orchestration/collaboration-workflow.md`；协调仓本身不复制会话分工与进度状态
  - PsyGuard 仓根目录新增 `AGENTS.md`：冻结期只读边界、项目地图指针、适配归属 NestJS `RiskProbePort`、服务不可达回落本地规则；不改任何 Python 服务代码
  - Framework `CHANGELOG.md` 的 `[Unreleased]` 修订号级文档修正段收录 `docs/state-machine.md` §8.1 状态面存储锚点条款，并说明 `conformance/normative-anchors.json` 同步增列该条款锚点
  - Framework `conformance/normative-anchors.json` 为 `docs/state-machine.md` §8.1 增列锚点条目，锚点短语为「状态面存储锚点」「本机持久目录」「退役台账」，且短语必须在正文中出现
  - 所有改动仅为规范文档与指令文件；`src/`、测试代码、迁移、种子数据与 PsyGuard Python 服务零改动
outOfScope:
  - 不清理 NestJS / Flutter 根目录临时日志与排查脚本（B1，另立独立任务并单独授权）
  - 不修复 AF-600 / AF-601 / AF-602 历史回执 schema 缺口（B2，另立独立任务）
  - 不处理 FEAT-VPT-REPORT-HISTORY 的合同哈希漂移阻塞项（旧战线，待对应任务单接单）
  - 不改 Framework 契约 schema、不变量清单或校验器实现
constraints:
  - 任务单、交付记录与新增指令文件统一 UTF-8 无 BOM + LF
  - 跨仓文档路径在协调仓 README 中使用相对路径，链接目标必须真实存在
  - 状态面只能经后端 CLI 写入；本单不手工编辑 `task-state-index.json` 或 `journal.jsonl`
---

# AF-603 · 补齐五仓协作规范文档缺口

## 1. 背景

主会话收口模式落地后，前后端两仓已写入会话分工与任务流转备忘及流程图。本轮按五仓现状盘点，识别出四类低风险文档缺口：

- **A1 协调仓索引**：`xinsu-coordination` README 偏流程叙述，缺目录职责一览与 CLI 子命令速查，新会话进入时需要自行翻 `cli.py` 才能定位命令。
- **A2 PsyGuard 指令入口**：`mofang-psyguard` 仓只有 README，缺 `AGENTS.md`；冻结期 AI 会话缺少明确的只读边界与适配归属说明。
- **A3 Framework 变更记录与锚点**：`docs/state-machine.md` §8.1「状态面存储锚点（实现约束）」已在工作树增补，但 `CHANGELOG.md` 的 `[Unreleased]` 尚未收录，`conformance/normative-anchors.json` 也未为该条款登记锚点短语。
- **A4 备忘反向指针**：协调仓 README 未指向前后端两份 `collaboration-workflow.md`，跨仓会话需要反查会话分工口径。

## 2. 改动清单

| 编号 | 仓库 | 文件 | 动作 |
| --- | --- | --- | --- |
| A1 | xinsu-coordination | `README.md` | 补目录职责表 + CLI 子命令速查表 |
| A2 | mofang-psyguard | `AGENTS.md` | 新增冻结期 AI 指令入口 |
| A3 | agent-collaboration-framework | `CHANGELOG.md` | `[Unreleased]` 修订号段收录 §8.1 条款与锚点同步说明 |
| A3 | agent-collaboration-framework | `conformance/normative-anchors.json` | 增列 state-machine §8.1 锚点条目 |
| A4 | xinsu-coordination | `README.md` | 补两份协作备忘相对路径指针 |

## 3. 闸门口径

- 后端 `events verify`：确认状态事件链与索引投影未被本单文档改动破坏。
- Framework `conformance/run.py`：契约面、样例、锚点短语一致性全绿；V11 CHANGELOG 同步闸门在启用时由本单 CHANGELOG 条目满足。
- 协调仓 `python -m unittest discover -s tests` 与 `cli.py validate`：单测全绿；既有 VPT 报告合同哈希漂移为旧战线遗留，不计入本单失败。
- 前端仓本轮无文档以外改动，不重跑 Flutter 编排校验。

## 4. 不做的事

根目录临时日志 / 排查脚本归档清理、历史回执 schema 修复、VPT 报告合同漂移处理，均属独立任务，需另行登记任务单并取得授权；本单不触碰其文件与代码。
