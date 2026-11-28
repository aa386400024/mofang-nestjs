---
taskId: AF-605
contextId: phase3-docs-governance
title: 前端协作备忘对齐小豆编排口径（AF-604 B1 跨仓文档同步）
type: documentation
status: backlog
riskClass: R0
baselineRef: fe845ffb3b7634fb6f7c7d4971c5bc8b51eb4f9a
dependsOn: [AF-604]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T23:03:44+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/worklog/pending/phase3-docs-governance-af605-frontend-memo-alignment-2026-11-28.md
    - docs/worklog/records/phase3-docs-governance/AF-605/
    - docs/worklog/completed/phase3-orchestration/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase3-orchestration/af605-frontend-memo-alignment-2026-11-28.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs events verify
    check: 后端事件链与索引投影一致
    threshold: PASS
  - command: node scripts/orchestration/cli.mjs validate --sheet docs/worklog/pending/phase3-docs-governance-af605-frontend-memo-alignment-2026-11-28.md
    check: 后端任务单契约校验通过
    threshold: 退出码 0
  - command: python tools/orchestration/cli.py validate
    check: 前端仓适配层契约与链接校验无新增失败
    threshold: 退出码 0 或既有债基线内无新增失败
successCriteria:
  - 前端备忘 `D:\work\Project\frontend\xin_su_app\docs\team\agent-orchestration\collaboration-workflow.md` 将旧“主会话”称谓统一为“小豆（编排中枢）”，职责边界与 AF-604 后端备忘一致：需求接收、标准化任务单、状态跟踪、阻塞跟进、台账维护、进度汇总、回执复核；不包揽复杂核心开发、深度架构推敲与大型模块代码评审
  - 前端备忘补齐轻量 / 核心分流判定：轻量为一次性脚本、只读查询、文案与备考资料整理、笔记结构化、文档规范化、台账只读核对，不碰 src、测试、迁移、种子、配置；核心为 Flutter 业务页面、组件、bloc 与状态流、客户端接口对接、framework 规范件变更、跨仓评审、涉及数据结构 / 权限会员 / 语音对练 / AI 评审链路的功能
  - 前端备忘任务单小节固定列出九字段：编号 AF-xxx、scope 范围（仓 + 目录 + 文件边界 + 排除项）、前置门禁条件、验收清单、依赖任务（编号 + 状态）、截止时间、执行方式（小豆直接交付 / 转发至 XX 豆包会话执行）、分流依据（轻量 / 核心 + 理由）、台账归属（NestJS docs/worklog 记录包路径；备考资料类可豁免）
  - 前端备忘补齐 `xinsu-task-executor` 技能隔离说明：技能无状态、幂等；会话容器隔离；任务状态落在任务单与 NestJS docs/worklog 台账，不落在技能内；Flutter 会话只读前端任务单，NestJS 会话只读后端任务单；跨仓依赖写明前置编号与完成态
  - 前端备忘补齐回执回流边界：执行方回执交回小豆复核闸门证据、changedFiles 与 scope 后才更新台账；技能不假设自动跨应用通道，不宣称已自动通知小豆或已自动更新台账
  - 保留前端仓专属事实：`tools/orchestration/cli.py`、前端 records / receipts / evidence 路径、Flutter 置顶会话边界、前端 README / task-template / acceptance-checklist 锚点；不把后端 CLI、后端状态面路径或后端台账目录复制进前端备忘
  - 协调仓 README 前后端备忘相对指针保持有效；Framework 仓经全仓检索确认无项目协作备忘引用，本单不新增 Framework 文档锚点；后续 Framework 规范件变更须另立任务单由小豆统一评审跨仓一致性
outOfScope:
  - 不修改 Flutter `lib/`、`test/`、生成代码、运行配置、依赖清单或任何业务逻辑
  - 不修改 NestJS `src/`、测试代码、迁移、种子数据、运行配置或环境启停脚本
  - 不改动 Framework 仓 schema、契约、校验器、conformance 规则或通用契约文档
  - 不触碰 PsyGuard Python 服务代码、数据与环境（冻结期）
  - 不处理 AF-600 / AF-601 / AF-602 历史回执 schema 缺口、VPT 报告合同哈希漂移、根目录临时日志与排查脚本清理、AF-545 缺 task-sheet.md 等既有遗留战线
  - 不清理或还原后端工作区既有 worklog migrate 遗留改动（legacy manifest 刷新、pending / archive 回执删除、未跟踪 legacy 记录包目录），本单不纳入提交
constraints:
  - 任务单、交付记录与备忘文档统一 UTF-8 无 BOM + LF
  - 后端状态面只能经 NestJS CLI 写入；前端状态面只能经前端 `tools/orchestration/cli.py` 写入；本单不手工编辑任何 `task-state-index.json` 或 `journal.jsonl`
  - 备忘引用的既有文件路径必须真实存在；不新增无指针的悬空链接
  - 跨仓改动以任务单 `scope.files` 与本备忘改动清单为授权边界；越界文件不进回执
---

# AF-605 · 前端协作备忘对齐小豆编排口径（AF-604 B1）

## 1. 背景

AF-604 已在后端备忘落定小豆编排中枢、轻量 / 核心分流、任务单九字段、技能隔离与回执回流口径。只读核对发现前端备忘仍是 AF-603 旧“主会话”口径，角色表、分流表、任务单字段、技能隔离与回执回流小节缺失；协调仓 README 仅保存前后端备忘反向指针，Framework 仓无项目备忘引用。本单承接 AF-604 的 B1 跨仓文档同步项，把前端备忘对齐到同一协作口径，同时保留前端仓自身的 CLI、台账路径与会话边界事实。

## 2. 执行方式

【执行方式：请转发至 Flutter 豆包会话执行；经 `xinsu-task-executor` 技能读取本任务单，仅更新前端备忘文档与前端仓必要台账指针，不承接业务编码】

分流依据：文档规范类轻量任务，但目标文件位于前端仓、需走前端适配层校验，因此由 Flutter 置顶会话在任务单授权切片内执行；回执回流小豆复核闸门证据、文件清单与 scope 隔离后，再由小豆更新 NestJS docs/worklog 台账并闭环。

## 3. 改动清单

| 编号 | 仓库 | 文件 | 动作 |
| --- | --- | --- | --- |
| B1-1 | xin_su_app | `docs/team/agent-orchestration/collaboration-workflow.md` | 角色称谓与职责对齐小豆编排中枢；补分流判定、九字段、技能隔离、回执回流小节；保留前端专属路径与会话边界 |
| B1-2 | mofang-nestjs | `docs/worklog/records/phase3-docs-governance/AF-605/` | 任务单副本、冻结回执、manifest 记录包 |
| B1-3 | mofang-nestjs | `docs/worklog/completed/phase3-orchestration/af605-frontend-memo-alignment-2026-11-28.md` | 交付记录：验收清单、闸门证据、scope 隔离、backlog 与结论 |

## 4. 闸门口径

1. 后端 `events verify`：事件链、哈希链与索引投影一致。
2. 后端任务单 `validate`：契约字段与任务单 schema 1.2.0 一致。
3. 前端 `python tools/orchestration/cli.py validate`：适配层契约、任务索引、回执与相对链接无新增失败；既有债按基线口径处理，不在本单顺手修复。
4. 文件清单核对：前端改动仅限授权备忘文档；后端改动仅限台账记录包与交付记录；`lib/`、`test/`、Framework 通用契约、PsyGuard 零改动。

## 5. 跨仓边界

- 协调仓 README 第 13–15 行指针已指向前后端备忘，本单只复核链接有效，不复制任务状态。
- Framework 仓 `docs/` 为通用契约文档，不承载心塑会话分工口径；本单不新增项目备忘引用。
- 后端台账 `docs/worklog` 仍是任务单、回执与交付记录的唯一事实源；前端仓适配层只维护自身状态面与前端任务记录。

## 6. 不做的事

Judge P0 三档主评、`judge?` 可选字段、首个 Judge provider 选型属功能开发战线，未在本单登记前不进入 `src/`；历史回执 schema、VPT 哈希漂移、临时脚本清理与 legacy migrate 遗留改动均保持原状，另立任务单授权后处理。
