---
taskId: AF-001
contextId: framework-bootstrap
type: documentation
status: ready
baselineRef: 2b03756
dependsOn: []
policyRefs: []
createdAt: 2026-11-15
---

# AF-001 · 通用多 Agent 协作框架仓库从零成型（独立仓库 · 通用层）

> 任务性质：纯文档 + JSON Schema + 模板骨架；**不写运行时代码、不建脚本 / CI / 依赖**。
> 执行方：MiniMax Code　｜　编排：主控 Doubao　｜　本任务单即契约，正文占位符以外不得自由增删契约字段。

## 1. 背景与目标

当前协作流程沉淀在某个业务后端仓库内，与业务实体、工具链、目录路径耦合。本任务把**通用协作框架**抽离为一个独立、厂商中立、可被任意项目复用的仓库；业务专属内容（目录、命令、红线、真实任务数据）一律不进通用层，由各项目通过薄 adapter 接入。

**最终交付**：在新目录 `E:\Work\Project\agent-collaboration-framework` 下建成完整框架仓库（规范 docs + JSON Schema + 模板 + adapter 规范 + 示例），本地 `git init` 并完成初始提交（**不 push**）。

## 2. 输入源（只读参考，不得复制其业务内容）

| 路径                                                                                                          | 用途                                                                                                  |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `E:\Work\Project\backend\mofang-nestjs\docs\architecture\multi-agent-baseline-profile-2026-11-15.md`          | **契约真相源**：角色、任务 / 工件字段、状态机、索引结构、验收五类、可靠性、演进路线                   |
| `E:\Work\Project\backend\mofang-nestjs\docs\architecture\multi-agent-collaboration-loop-design-2026-11-15.md` | 目标态背景：编排模式、记忆分层、安全策略、HITL、升级消息标准；通用概念可吸收，项目附录 A 约束不得带入 |
| `E:\Work\Project\backend\mofang-nestjs\docs\team\agent-orchestration\README.md`                               | 现有编排规则草稿（通用部分抽象来源）                                                                  |
| `E:\Work\Project\backend\mofang-nestjs\docs\team\agent-orchestration\relay-receipt-template.md`               | 回执七组字段草稿                                                                                      |
| `E:\Work\Project\backend\mofang-nestjs\docs\team\agent-orchestration\acceptance-checklist.md`                 | 验收五类草稿                                                                                          |
| `E:\Work\Project\backend\mofang-nestjs\docs\team\agent-orchestration\task-state-index.json`                   | 索引结构草稿（仅结构参考；其中真实任务数据不得带入示例）                                              |

## 3. 最终产物清单（逐文件，缺一不可）

```
agent-collaboration-framework/
├── README.md                         # 框架定位 · 两层模型（通用层 / 项目 adapter）· 目录导览 · 快速上手
├── CHANGELOG.md                      # semver 版本记录；首版 1.0.0
├── docs/
│   ├── roles.md                      # 角色模型：Human / Orchestrator / Executor / Reviewer(兼任) / Researcher / Critic(预留)；职责、边界、隔离要求；编排模式（Orchestrator-Subagent 为主，Agent Team 预留）
│   ├── task-contract.md              # 任务与工件标准字段组；概念映射（Task/Message/Part/Artifact/contextId/Agent Card）；provenance 与工件不可变规则
│   ├── state-machine.md              # 状态枚举 · 迁移路径 · 状态规则（终态不可变、依赖解锁、版本锚点、中断可追溯）
│   ├── receipt-contract.md           # 回执 / 交付记录七组字段：落地 / 证据 / 范围 / 契约 / 遗留 / 偏差 / 结论
│   ├── acceptance.md                 # 验收五类核对 · 脚本化项与人工判断分界 · 结论三级（passed / conditional-pass / rejected）
│   ├── reliability.md                # 幂等 · claim 租约与超时释放 · 重试与失败定性 · 断路器 / 死信预留位 · 崩溃恢复 · 任务不可变
│   ├── context-and-memory.md         # 上下文隔离 · 记忆分层（工作 / 共享 / 工件 / 长期案例）· 跨代理只传契约字段与工件引用 · 崩溃后依 taskId 重建
│   ├── security-and-policy.md         # 角色-工具-资源三级最小权限 · 工具副作用分级 · secrets 不进任务文本 / 工件 · 审计关联 ID · 策略即代码原则（机读可判 vs 人工判断分层）
│   ├── human-in-the-loop.md          # 环内 / 环上两种模式 · 审批节点 · 升级触发条件 · 升级消息标准字段（taskId / contextId / 当前状态 / 已尝试路径 / 失败证据 / 可选方案 / 建议决策点）
│   └── evolution.md                  # L0 文件+JSON → L1 MCP 工具标准化 → L2 状态持久化 → L3 A2A 协议化；各档触发条件、不变项；模型不变只换传输层
├── schemas/
│   ├── task-sheet.schema.json        # 任务单契约 JSON Schema（Draft 2020-12）
│   └── task-state-index.schema.json  # 状态索引 JSON Schema（Draft 2020-12）
├── templates/
│   ├── task-sheet.template.md        # 任务单模板骨架（frontmatter 字段 + 正文章节占位，无项目命令 / 目录）
│   └── receipt.template.md          # 回执 / 交付记录模板骨架（七组字段）
├── adapters/
│   └── README.md                     # 项目适配层规范：adapter 必须声明的映射项（项目标识、目录映射、工具与闸门命令、策略锚点、框架版本依赖）；只定义字段，不写任何具体项目取值
└── examples/
    └── example-task-state-index.json # 示意样例（明确标注非真实任务；任务号 EX-001，contextId demo-context）
```

## 4. Schema 字段定义（契约，不得删减必填项）

### 4.1 任务单（task-sheet）字段

| 字段组   | 字段                                                              | 必填 | 说明                                                                           |
| -------- | ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------ |
| 标识     | `taskId`                                                          | 是   | 唯一标识，格式 `^[A-Z0-9]+-[0-9]+`                                             |
| 标识     | `contextId`                                                       | 是   | 同主题多任务归组；返修新任务沿用                                               |
| 标识     | `type`                                                            | 是   | implementation / review / investigation / documentation / fix / verification   |
| 标识     | `title`                                                           | 是   | 一句话标题                                                                     |
| 标识     | `status`                                                          | 是   | 见 §5 状态枚举                                                                 |
| 标识     | `baselineRef`                                                     | 否   | 版本锚点（commit ref 或等价版本标识）                                          |
| 标识     | `dependsOn`                                                       | 否   | 上游 taskId 数组                                                               |
| 标识     | `policyRefs`                                                      | 否   | 策略规则锚点数组（由 adapter 定义具体指向）                                    |
| 标识     | `createdAt`                                                       | 是   | ISO 日期                                                                       |
| 目标     | `objective` / `successCriteria[]` / `outOfScope[]`                | 否   | 做什么 / 验收标准 / 明确排除                                                   |
| 上下文   | `references[]` / `priorTasks[]` / `constraints[]`                 | 否   | 引用工件 / 前置任务 / 硬约束                                                   |
| 切片     | `scope{files[],modules[],interfaces[]}` / `exclusions[]`          | 否   | 纳入范围与排除项                                                               |
| 能力     | `requiredSkills[]` / `requiredTools[]` / `agentRole`              | 否   | 路由所需；agentRole ∈ orchestrator / executor / reviewer / researcher / critic |
| 交付物   | `artifacts[]{name,path,kind}` / `artifactSchema` / `deliveryPath` | 否   | 产出清单 / 结构标识 / 落点                                                     |
| 质量门禁 | `gates[]{command,check,threshold}` / `evidenceFormat`             | 否   | 检查项与证据格式；具体命令由 adapter 定义                                      |
| 风险     | `escalationTriggers[]`                                            | 否   | 升级触发条件                                                                   |
| 调度     | `priority` / `deadline` / `retention`                             | 否   | 优先级 / 截止时间 / 保留策略                                                   |

### 4.2 状态索引（task-state-index）字段

顶层：`version`（semver 必填）、`schemaRef`、`note`、`tasks[]`、`archivedTasks[]`。

任务记录：`taskId*`、`contextId`、`type`、`title`、`status*`、`agent`、`baselineRef`、`dependsOn[]`、`policyRefs[]`、`createdAt`、`claimedAt`、`deadline`、`artifacts{taskSheet,deliveryRecord,reply}`（路径字符串或 null）、`verdict{result,rationale}`、`history[]{at,from,to,by}`。

归档记录：`taskId*`、`status*`、`artifacts{taskSheet,deliveryRecord}`（轻量指针，无运行态字段）。

## 5. 状态枚举（统一口径）

`backlog` · `ready` · `submitted` · `working` · `input-required` · `completed` · `failed` · `canceled` · `rejected`；`auth-required` 作为预留枚举值保留（当前形态不使用）。

- 终态：`completed / failed / canceled / rejected`，不可变；
- 活跃：`submitted / working`；中断：`input-required`；编排前置：`backlog / ready`；
- schema 注释注明与 A2A v1.0 大写状态值的映射关系（SUBMITTED / WORKING / INPUT_REQUIRED / COMPLETED / FAILED / CANCELED / REJECTED）。

## 6. 硬约束（违反即返工）

### 6.1 内容黑名单（通用层文档 / schema / 模板 / 示例中**零命中**）

- 业务实体与项目名：`mofang`、`nestjs`、`xinsu`、`心塑`、`counselor`、`quote`、`life-map`、`consent`、`emergency`、`diary`、`visitor`、`persona`、`supervision`、`analytics`、`home-message`、`moodlog`；
- 工具链与框架名：`pnpm`、`npx`、`vitest`、`tsc`、`eslint`、`oxlint`、`doctor:fs`、`engine-core`、`engine-adapters`、`admin-dashboard`、`flutter`、`vue`、`nestjs`、`typeorm`、`migration`、`redis`、`bullmq`；
- 真实任务标识与仓库路径：`TD-5` … `TD-21`、`phase2.5`、`phase3`、`P-DEBT`、`conventions.md`、`gate-performance`、`docs/worklog`、任何真实 commit sha；
- 示例中只允许中性占位：任务号 `EX-001`、`contextId: demo-context`、路径 `<adapter-root>/...`。

### 6.2 技术边界

- 纯 Markdown + JSON Schema（Draft 2020-12）+ Markdown 模板；**不写**可执行代码、脚本、CI 配置、依赖清单；
- 所有文本文件 UTF-8 无 BOM；换行 LF；
- 框架不规定具体目录名、命令、测试框架、语言栈；这类内容只在 adapter 规范里作为「待项目声明的映射项」出现；
- MCP、A2A 仅作为概念与演进扩展位在 `evolution.md` / `roles.md` 提及，**不实现**协议适配；
- Schema 字段可扩展、不删除既有字段；`additionalProperties` 允许附加字段。

### 6.3 仓库与 git 边界

- 只在 `E:\Work\Project\agent-collaboration-framework` 目录内写文件；
- **不修改** `E:\Work\Project\backend\mofang-nestjs` 仓库的任何文件，不暂存、不提交该仓库任何内容；
- 框架仓库本地 `git init`，初始提交信息 `chore: bootstrap agent-collaboration-framework v1.0.0`；**不配置远端、不 push**；
- 不引入未声明的第三方依赖。

### 6.4 角色隔离

- 文档中 Reviewer 与 Executor 必须为分离角色；兼任时验收结论只能基于工件证据与抽跑复现，不接受执行侧自述通过；验收阶段不改实现。

## 7. 闸门与自验（交付前必须跑完并写入交付记录）

| #   | 检查         | 判据                                                                           |
| --- | ------------ | ------------------------------------------------------------------------------ |
| 1   | 文件齐全非空 | §3 清单 18 个路径全部存在且字节数 > 0                                          |
| 2   | JSON 合法    | 两个 schema 与示例 JSON 均可解析；示例通过 `task-state-index.schema.json` 校验 |
| 3   | 黑名单扫描   | 对 `docs/ schemas/ templates/ examples/` 全文扫描 §6.1 黑名单词，命中数 0      |
| 4   | 编码         | 全部文件 UTF-8 无 BOM                                                          |
| 5   | 模板一致性   | 模板占位符与 schema 字段名一一对应，无悬空字段                                 |
| 6   | git          | 框架仓库 `git log` 恰 1 条初始提交；工作区无未跟踪遗漏                         |

> 本仓库无业务测试；闸门即以上结构与一致性检查。检查命令、退出码、命中数字如实写入交付记录，不留「待执行」。

## 8. 交付物与回执

1. 交付记录写到框架仓库外的主控工作区：`E:\Work\Project\backend\mofang-nestjs\docs\worklog\completed\phase2.5\af001-framework-bootstrap-implementation-2026-11-15.md`，含：文件清单（18 路径 + 字节数）、闸门表（命令 / 退出码 / 命中数）、偏差表、遗留项；
2. 回执原文写到（固定文件名，便于轮询检测）：`E:\Work\Project\backend\mofang-nestjs\docs\worklog\pending\archive\relay-response-af001-20261115.md`；
3. 回复输出：在对话里说一句"已写入交付记录"并附路径，报告闸门数字与文件计数，不贴文件全文；
4. 不自动 commit / push mofang 仓库；框架仓库初始提交除外（§6.3）。
