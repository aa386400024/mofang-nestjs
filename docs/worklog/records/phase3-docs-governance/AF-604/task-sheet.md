---
taskId: AF-604
contextId: phase3-docs-governance
title: 更新协作备忘：小豆编排口径、任务单模板字段与任务执行技能隔离说明
type: documentation
status: backlog
riskClass: R0
baselineRef: fe845ffb3b7634fb6f7c7d4971c5bc8b51eb4f9a
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T22:49:12+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/team/agent-orchestration/collaboration-workflow.md
    - docs/worklog/pending/phase3-docs-governance-af604-collaboration-workflow-update-2026-11-28.md
    - docs/worklog/records/phase3-docs-governance/AF-604/
    - docs/worklog/completed/phase3-orchestration/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase3-orchestration/af604-collaboration-workflow-update-2026-11-28.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链与索引投影一致
    threshold: PASS
  - command: node scripts/orchestration/cli.mjs validate --sheet docs/worklog/pending/phase3-docs-governance-af604-collaboration-workflow-update-2026-11-28.md
    check: 任务单契约校验通过
    threshold: 退出码 0
successCriteria:
  - 协作备忘角色表补充小豆（主会话编排中枢）职责口径：需求接收、标准化任务单、状态跟踪、阻塞跟进、台账维护、进度汇总；不包揽复杂核心开发、深度架构推敲与大型模块代码评审
  - 备忘分流规则补充轻量 / 核心判定口径：轻量为一次性脚本、只读查询、文案与备考资料整理、笔记结构化、文档规范化、台账只读核对，不碰 src、测试、迁移、种子、配置；核心为 Flutter 业务页面与 bloc、NestJS 接口服务与 Qdrant 检索、framework 规范件变更、跨仓评审、涉及数据结构 / 迁移 / 权限会员 / 语音对练 / AI 评审链路的功能
  - 备忘任务单字段小节固定列出：编号 AF-xxx、scope 范围（仓 + 目录 + 文件边界 + 排除项）、前置门禁条件、验收清单、依赖任务（编号 + 状态）、截止时间、执行方式（小豆直接交付 / 转发至 XX 豆包会话执行）、分流依据（轻量 / 核心 + 理由）、台账归属（NestJS docs/worklog 记录包路径；备考资料类可豁免）
  - 备忘新增任务执行技能隔离说明：技能 xinsu-task-executor 无状态、幂等；会话容器隔离；状态落在任务单与 NestJS docs/worklog 台账，不落在技能内；Flutter 会话只读前端任务单，NestJS 会话只读后端任务单；跨仓依赖任务写明前置编号与完成态，后端先闭环、前端再接跟随任务
  - 备忘回执回流边界写明：执行方回执交回小豆复核闸门证据、changedFiles 与 scope 后才更新台账；技能不假设自动跨应用通道，不宣称已自动通知小豆或已自动更新台账
  - 备忘标注跨仓同步要点：前端协作备忘与 framework 适配层引用需对齐本口径；本单不直接改动前端仓与 framework 仓文件，跨仓文档改动另立任务单授权
outOfScope:
  - 不修改 src、测试代码、迁移、种子数据、运行配置或环境启停脚本
  - 不触碰 PsyGuard Python 服务代码、数据与环境（冻结期）
  - 不改动 framework 仓 schema、契约、校验器或 conformance 规则
  - 不处理 AF-600 / AF-601 / AF-602 历史回执 schema 缺口、VPT 报告合同哈希漂移、根目录临时日志清理等既有遗留战线
  - 不清理或还原工作区既有 worklog migrate 遗留改动（manifest 刷新与回执迁移件），本单不纳入提交
constraints:
  - 任务单、交付记录与备忘文档统一 UTF-8 无 BOM + LF
  - 状态面只能经后端 CLI 写入；本单不手工编辑 task-state-index.json 或 journal.jsonl
  - 备忘引用的既有文件路径必须真实存在；不新增无指针的悬空链接
---

# AF-604 · 更新协作备忘：小豆编排口径、任务单模板字段与任务执行技能隔离说明

## 1. 背景

AF-603 已完成五仓协作规范文档缺口补齐。本轮在豆包多会话 + 小豆编排中枢 + MiniMax Code 的协作模式下，需要把确认后的分工口径、任务单固定字段、执行技能隔离机制与回执回流边界落进后端协作备忘，作为后续任务编排与派发的项目口径。

## 2. 执行方式

本单为文档规范任务，由小豆（主会话编排中枢）直接交付：更新备忘、登记台账、产出交付记录与回执。不派发 Flutter 或 NestJS 豆包会话执行编码。

## 3. 备忘更新要点

### 3.1 角色与会话分工

在现有角色表基础上补充小豆职责边界，明确与执行会话、MiniMax Code 的分工：编排与台账归小豆；客户端实现归 Flutter 会话；后端引擎与台账执行归 NestJS 会话；framework 规范评审归主会话 + framework 仓；MiniMax Code 承接 scope 明确的编码实现。

### 3.2 分流判定

任务进入小豆后先判定轻量 / 核心：
- 轻量：一次性脚本、只读查询、文案整理、备考资料归集、笔记结构化、文档规范化、台账只读核对；不碰 src、测试、迁移、种子、配置。
- 核心：Flutter 业务页面、组件、bloc 与状态流、客户端接口对接；NestJS 接口、服务、Qdrant 检索与向量召回、台账引擎；framework schema、契约、校验器改动；跨仓评审；涉及数据结构、迁移、权限会员、语音对练、AI 评审链路的功能。
- 边界判定：小脚本进入 src 转为核心；简单接口改动契约转为核心；文档治理批量改动记轻量但范围较大时仍登记台账任务单。

### 3.3 任务单固定字段

任务单模板固定字段：编号 AF-xxx；scope 范围（仓、目录、文件边界、排除项）；前置门禁条件；验收清单；依赖任务（编号 + 状态）；截止时间；执行方式（小豆直接交付 / 转发至 XX 豆包会话执行）；分流依据（轻量 / 核心 + 理由）；台账归属（NestJS docs/worklog 记录包路径；备考资料类可豁免）。

### 3.4 执行技能隔离

xinsu-task-executor 技能无状态、幂等，每次调用只读取任务单、按边界执行、产出回执。会话容器隔离：Flutter 会话与 NestJS 会话各自独立上下文，互不可见。任务状态落在任务单（编号、scope.files、回执）与 NestJS docs/worklog 台账，不落在技能内。共享契约改动由后端任务单牵头、前端跟随；同一编号不重复派发；后端台账状态面只经 CLI 写，前端不直接触碰。

### 3.5 回执回流

执行方回交回执 JSON 路径、交付记录路径、taskId、finalStatus、reviewVerdict、commit/push 状态与遗留阻塞。小豆复核闸门证据、changedFiles 与 scope 隔离后更新台账。执行技能不假设自动跨应用通道，不得宣称已自动通知小豆或已自动更新台账。

## 4. 闸门与验收

1. `events verify` 通过：事件链、哈希链与索引投影一致。
2. 任务单 `validate` 通过，契约字段与任务单 schema 1.2.0 一致。
3. 备忘改动仅落在授权文档文件；src、测试、迁移、种子、配置、PsyGuard、framework 规范件零改动。
4. 备忘引用路径真实存在，无悬空链接。

## 5. 跨仓同步说明

前端协作备忘（xin_su_app/docs/team/agent-orchestration/collaboration-workflow.md）与 framework 适配层引用应对齐本口径；本单不直接改动上述仓文件，跨仓文档改动在其各自任务单授权下执行。
