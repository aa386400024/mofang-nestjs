---
taskId: AF-007
contextId: framework-evolution
title: 框架 L1 工具标准化 —— 标准工具原语、IO 契约、副作用分级、权限收口与调用审计
type: implementation
status: completed
baselineRef: 5d464f7
dependsOn: []
policyRefs: [framework/security-and-policy.md, framework/roles.md, framework/evolution.md]
createdAt: 2026-11-15
---

# AF-007 · 框架 L1 工具标准化

> 状态：✅ 已交付（2026-11-15）｜交付记录：docs/worklog/completed/phase2.5/af005-008-framework-evolution-implementation-2026-11-15.md｜编排：主控 Doubao
> 仓库：本仓 `E:\Work\Project\backend\mofang-nestjs`（adapter 侧登记）；规范与工具契约落点预期为框架仓 `E:\Work\Project\agent-collaboration-framework`
> 任务性质：框架工具链演进；本单当前**不实现**，仅立项登记；触发条件满足后另开 ready 子单实施。AF-006（机读校验工具固化）是本单在「校验工具」上的子集。

## 0. 【必读入口】动手前按顺序读完

1. 框架仓 `docs/evolution.md` §2 L1 档、§3.2 工具标准化细则与触发判据
2. 框架仓 `docs/security-and-policy.md` §1 权限模型（角色 → 工具 → 资源）、§2 工具副作用分级、§7 审计关联标识
3. 框架仓 `docs/roles.md` §5 能力声明（Agent Card 概念位）、§3 角色隔离硬规则
4. 框架仓 `docs/task-contract.md`（任务与工件契约；本单不得改契约字段）
5. 本仓适配层 `docs/team/agent-orchestration/README.md`（目录映射、角色绑定、工具闸门现状）

## 1. 背景

L0 阶段，仓库读写、检查执行、版本控制、检索、状态索引读写等动作由裸命令与临时脚本承担，动作口径分散在各任务的交付记录里；工具动作没有标准原语、没有输入 / 输出契约、没有副作用声明，权限校验与调用审计也未在工具层统一收口。框架 `docs/security-and-policy.md` §1–§2 已定三级权限链与副作用分级规则（只读 / 受限写 / 敏感操作），`roles.md` §5 留了能力声明概念位；L1 阶段把这些规则落地为标准工具服务契约。

框架 `evolution.md` §3.2 规定 L1：把仓库读写、检查执行、版本控制、检索等动作封装为标准工具，每个工具声明输入 / 输出契约、副作用类型与所需权限；工具侧收口权限校验与调用审计；交接面不变，只是「怎么调」从裸命令变成标准原语。触发判据：同一动作在不同任务里被反复用不同方式调用，或权限边界说不清。现状已出现前者：git / 文件 / 闸门 / 索引读写动作在跨任务里重复手工执行、口径分散。

## 2. 范围（严格遵守，不越权）

**触发后在范围内（预期）：**

- 标准工具原语清单：覆盖 L0 交接面反复使用的动作类别（仓库读写、检查执行、版本控制、检索、状态索引读写等）；
- 每个工具的输入 / 输出契约（参数、返回结构、错误形态）；
- 副作用分级映射：只读 / 受限写 / 敏感操作与 `security-and-policy.md` §2 分级一一对应；
- 角色 → 工具 → 资源白名单收口：权限校验在工具层统一收口，代理侧不持有底层凭据或内部句柄；
- 工具调用审计记录：调用方、工具、作用资源、副作用级别、结果关联标识；
- 必要时引入工具契约 JSON Schema（与既有 task-sheet、task-state-index schema 同档管理）；
- AF-006 校验工具作为本单子集一并纳入标准工具体系。

**明确不在范围内：**

- 不改任务单字段组、工件模型、状态枚举与有效迁移（契约不变项）；
- 不动本仓业务代码（`src/` / `test/` / `bin/` / `scripts/`）；
- 不实现代理协议适配或协议栈依赖（属 L3，见 AF-008）；
- 不替代 / 旁路 L0 文件 + cron 闭环；通用层不出现项目取值、命令名、路径或业务实体。

## 3. 目标架构 / 交付物（触发后立项时细化）

> 进度备注（2026-11-15）：规范层标准件已落地框架仓 v1.2.0 —— `docs/tools.md`（工具类别、声明结构、IO 契约、副作用分级、权限收口、调用审计）、`schemas/tool-contract.schema.json`、`templates/tool.template.md`、`examples/example-tool-contract.json`。工具运行时服务化与并行调度仍属 L1 演进承载，留本单 backlog，触发后另开 ready 子单。

- 工具契约规范备忘：原语清单、IO 契约、副作用分级、权限白名单模型、审计记录结构；
- 工具契约 schema（若进入实现阶段）与中性占位样例；
- 适配层工具映射（项目特定命令、资源路径只落在本仓 adapter）；
- 验收：既有两类 schema 校验通过；五类验收留证；L0 既有闭环回归不破坏。

## 4. 红线（违反即返工）

- 契约只增不删；任务 / 工件 / 状态模型向后兼容；
- 默认拒绝、白名单授权；未声明的能力与资源一律不可达；
- 通用层零业务耦合；工具副作用分级必须显式声明，不做推断；
- 终态不可变；返修沿用同一 `contextId` 新开任务，不新增返修关联字段；
- 实施阶段不自动 commit / push；提交分组与闸门按交付标准执行。

## 5. 闸门（触发后实施时填真实数字）

实施子单按框架 `docs/acceptance.md` 五类核对 + 本仓 / 框架仓既有闸门执行；本 backlog 单不跑闸门。

## 6. 交付记录路径（实施完成后）

`docs/worklog/completed/phase2.5/af007-framework-evolution-tool-standardization-implementation-{{YYYY-MM-DD}}.md`

## 7. 回写清单（实施完成后）

- [x] 交付记录落固定路径；任务单归档成对；wp-list / 阶段入口 / 索引同步回写；
- [x] 索引状态迁移追加 `history`，工件指针填全；
- [x] 审计链闭合：`taskId` 贯穿任务单 / 交付记录 / 回执 / commit message。
