---
taskId: AF-610
contextId: phase3-orchestration
title: 前端协作备忘同步台账回收口径，去除主会话重复验收表述
type: documentation
status: backlog
riskClass: R0
baselineRef: 4da1753817f34088cc765ea9c700412c072a86cc
dependsOn: [AF-609]
priorTasks: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T23:46:07+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/worklog/pending/phase3-orchestration-af610-frontend-memo-ledger-intake-scope-2026-11-28.md
    - docs/worklog/records/phase3-orchestration/AF-610/
    - docs/worklog/completed/phase3-orchestration/af610-frontend-memo-ledger-intake-scope-2026-11-28.md
  modules: []
  interfaces: []
artifacts:
  - name: AF-610 前端备忘口径同步交付记录
    path: docs/worklog/completed/phase3-orchestration/af610-frontend-memo-ledger-intake-scope-2026-11-28.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs events verify
    check: 后端事件链、哈希链与索引投影一致
    threshold: PASS
  - command: node scripts/orchestration/cli.mjs validate --sheet docs/worklog/records/phase3-orchestration/AF-610/task-sheet.md
    check: AF-610 任务单契约校验通过；历史 AF-600 / AF-601 / AF-602 schema 缺口不计入本单新增失败
    threshold: AF-610 任务单元 PASS
  - command: python tools/orchestration/cli.py validate
    check: 前端仓适配层契约、任务索引、回执与相对链接无新增失败；既有债按基线口径处理
    threshold: 退出码 0 或既有债基线内无新增失败
successCriteria:
  - 前端备忘 `D:\work\Project\frontend\xin_su_app\docs\team\agent-orchestration\collaboration-workflow.md` 将“小豆复核闸门证据、changedFiles 与 scope”的重复验收表述，同步为执行方自验收后，小豆只做回执工件、字段、路径、跨仓引用与台账状态的元数据回收
  - 前端角色表、闭环流程图、§3.6 回执回流边界与验收重点明确：测试、lint、analyze、typecheck 等业务闸门由 Flutter / NestJS / MiniMax 执行方负责；小豆不现场抽跑或复跑这些闸门
  - 前端备忘保留本仓事实：`tools/orchestration/cli.py`、前端 records / receipts / evidence 路径、Flutter 置顶会话边界、前端 README / task-template / acceptance-checklist 锚点；不复制后端 CLI、后端状态面路径或后端台账目录
  - 后端 NestJS `docs/worklog` 仍是跨仓 AF 任务单、回执与交付记录的唯一事实源；前端仓适配层只维护自身状态面与前端任务记录
outOfScope:
  - 不修改 Flutter `lib/`、`test/`、生成代码、运行配置、依赖清单或任何业务逻辑
  - 不修改 NestJS `src/`、测试代码、迁移、种子数据、运行配置或环境启停脚本
  - 不改动 Framework 仓 schema、契约、校验器、conformance 规则或通用契约文档
  - 不触碰 PsyGuard Python 服务代码、数据与环境（冻结期）
  - 不处理 AF-600 / AF-601 / AF-602 历史回执 schema 缺口、VPT 报告合同哈希漂移、根目录临时日志与排查脚本清理、AF-545 缺 task-sheet.md 等既有遗留战线
  - 不清理或还原后端工作区既有 worklog migrate 遗留改动（legacy manifest 刷新、pending / archive 回执删除、未跟踪 legacy 记录包目录），本单不纳入提交
constraints:
  - 状态面只能经对应仓库 CLI 写入；本单不手工编辑任何 `task-state-index.json`、`journal.jsonl`、快照或 Web 投影
  - 前端仓提交不写入后端回执 `changedFiles.commits`；他仓提交与工件引用走 `artifactRefs.others`
  - 备忘引用的既有文件路径必须真实存在；不新增无指针的悬空链接
  - 跨仓改动以任务单 scope 与备忘改动清单为授权边界；越界文件不进回执
---

# AF-610 · 前端协作备忘同步台账回收口径，去除主会话重复验收表述

## 1. 背景

AF-609 已在后端备忘与小豆本地技能中落定新分工：执行方完成 scope 实现、闸门运行与自验收后，小豆只做台账登记、回执字段与工件路径核对、scope 元数据、跨仓引用和归档状态核对，不再复跑测试、lint、analyze、typecheck 等业务闸门。

只读核对发现 Flutter 仓同名备忘仍保留“小豆复核闸门证据、changedFiles 与 scope”“验收只基于工件证据与可复现闸门”等旧口径。本单承接 AF-609 的跨仓文档同步切片，把前端备忘对齐到同一回收边界，同时保留前端仓自身 CLI、台账路径与会话边界事实。

## 2. 执行方式

【执行方式：请转发至 Flutter 豆包会话执行；经 `xinsu-task-executor` 技能读取本任务单，仅更新前端备忘文档与前端仓必要台账指针，不承接业务编码】

分流依据：R0 文档规范任务；目标文件位于前端仓、需走前端适配层校验，因此由 Flutter 置顶会话在授权切片内执行。回执回流后，小豆只做台账回收与元数据核对，不再重复跑前端业务闸门。

## 3. 改动清单

| 编号 | 仓库 / 位置 | 文件 | 动作 |
| --- | --- | --- | --- |
| F1-1 | xin_su_app | `docs/team/agent-orchestration/collaboration-workflow.md` | 将主会话重复验收表述改为执行方自验收 + 小豆台账回收；保留前端专属路径与会话边界 |
| F1-2 | mofang-nestjs | `docs/worklog/records/phase3-orchestration/AF-610/` | 任务单副本、冻结回执、manifest 记录包 |
| F1-3 | mofang-nestjs | `docs/worklog/completed/phase3-orchestration/af610-frontend-memo-ledger-intake-scope-2026-11-28.md` | 交付记录：验收清单、闸门证据、scope 隔离、backlog 与结论 |

## 4. 回收边界

### 4.1 执行方负责

- 任务 scope 内的实现、测试、lint、analyze、typecheck、提交与回执材料。
- 闸门命令、退出码、错误 / 警告 / 用例数、失败项归因和偏差记录。
- 回执 `reviewVerdict`、`scopeCheck`、`contractChecks`、`backlogItems`、`deviationTable` 等字段自洽。

### 4.2 小豆负责

- 回执、交付记录和工件路径是否回流到指定台账位置。
- 回执 verdict、scope、依赖、遗留项、偏差和跨仓引用是否与任务单口径一致。
- 台账状态是否经 CLI 归档；事件链、归档计数和任务索引是否一致。
- 发现字段缺失、工件路径不一致、越界引用或台账状态异常时，退回执行方补正；不替代执行方重跑业务验收。

## 5. 闸门口径

1. 后端 `events verify`：事件链、哈希链与索引投影一致。
2. 后端任务单 `validate`：契约字段与任务单 schema 1.2.0 一致；AF-610 任务单元 PASS。
3. 前端 `python tools/orchestration/cli.py validate`：适配层契约、任务索引、回执与相对链接无新增失败；既有债按基线口径处理，不在本单顺手修复。
4. 文件清单核对：前端改动仅限授权备忘文档；后端改动仅限台账记录包与交付记录；`lib/`、`test/`、Framework 通用契约、PsyGuard 零改动。

## 6. 不做的事

Judge P0 三档主评、`judge?` 可选字段、Judge provider 选型、AF-604 PR 合并、后端台账 PR 创建、Flutter 本地提交推送、历史回执 schema 修复与 legacy migrate 清理均不在本单；后续需各自满足任务单登记与授权口径。
