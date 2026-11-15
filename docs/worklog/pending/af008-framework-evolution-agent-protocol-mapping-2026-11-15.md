---
taskId: AF-008
contextId: framework-evolution
title: 框架 L3 代理协议化映射 —— Agent Card 能力声明与任务 / 消息 / 工件标准映射（远期概念位）
type: implementation
status: backlog
baselineRef: 5d464f7
dependsOn: []
policyRefs: [framework/evolution.md, framework/state-machine.md, framework/task-contract.md]
createdAt: 2026-11-15
---

# AF-008 · 框架 L3 代理协议化映射（backlog · 远期概念位，触发后立项）

> 状态：📋 backlog（2026-11-15）｜编排：主控 Doubao｜执行方：待定（触发时派发）
> 仓库：本仓 `E:\Work\Project\backend\mofang-nestjs`（adapter 侧登记）；规范映射落点预期为框架仓 `E:\Work\Project\agent-collaboration-framework`
> 任务性质：远期演进概念位；本单当前**不实现**协议适配、客户端 / 服务端或协议栈依赖；登记映射方向，触发条件满足后另开 ready 子单。

## 0. 【必读入口】动手前按顺序读完

1. 框架仓 `docs/evolution.md` §2 L3 档、§3.4 代理协议化细则、§4 协议概念扩展位
2. 框架仓 `docs/state-machine.md` §2 与标准协议状态值的映射、§1 状态枚举
3. 框架仓 `docs/task-contract.md` §2 概念映射、§3 任务单字段组、§4 工件模型
4. 框架仓 `docs/roles.md` §5 能力声明（Agent Card 概念位）
5. 本仓适配层 `docs/team/agent-orchestration/README.md`

## 1. 背景

现状执行代理为主控 Doubao 与 MiniMax Code，交接走文件简报 + 回执文件，未接入标准代理协议。框架 `evolution.md` §3.4 规定 L3：接入标准代理协议（代理能力声明 + 任务 + 消息 + 工件），现有字段直接映射，不需要改任务契约 —— 任务单 → 任务、状态 → 任务状态、工件指针 → 工件引用、`contextId` → 归组标识；本框架九态与标准状态集合保持映射。触发判据：出现第二个稳定执行代理，或需要跨机器 / 跨系统协作。

当前文件交接可支撑现有单队列协作；框架现行版本明确不提供协议适配器、不提供协议客户端 / 服务端、不写任何协议栈依赖（`evolution.md` §4）。本单只登记映射方向与触发条件，不在 L0 / L1 / L2 阶段提前实现。

## 2. 范围（严格遵守，不越权）

**触发后在范围内（预期）：**

- Agent Card 能力声明标准：代理角色、能力上限、工具子集、资源范围；
- 任务 / 消息 / 工件到标准协议的字段映射复核（任务单 → 任务、状态 → 任务状态、工件指针 → 工件引用、`contextId` → 归组标识）；
- 框架九态到标准协议状态值的映射复核（沿用 `state-machine.md` §2 既有映射）；
- 协议适配层选型评估（仅评估，不绑定特定厂商或协议实现）。

**明确不在范围内：**

- 不实现协议适配器、协议客户端 / 服务端，不引入任何协议栈依赖；
- 不改契约内容、验收流程与工件标准（不变项，见 `evolution.md` §5）；
- 不改变 L0 / L1 / L2 的承载方式；不动本仓业务代码；
- 通用层不出现项目取值、命令名、路径或业务实体。

## 3. 目标架构 / 交付物（触发后立项时细化）

- 协议映射备忘：能力声明结构、字段映射表、状态映射复核结论、适配选型取舍；
- 若进入实现阶段：与框架既有 schema 同档管理的能力声明 schema（中性占位样例）；
- 验收：既有两类 schema 校验通过；五类验收留证；既有 L0 闭环与归档格式回归不破坏。

## 4. 红线（违反即返工）

- 模型不变、只换传输层：契约字段、状态枚举、回执字段、验收口径保持不变；
- 厂商中立：不绑定特定代理协议、厂商或存储实现；
- 通用层零业务耦合；终态不可变；返修沿用同一 `contextId` 新开任务；
- 实施阶段不自动 commit / push；提交分组与闸门按交付标准执行。

## 5. 闸门（触发后实施时填真实数字）

实施子单按框架 `docs/acceptance.md` 五类核对 + 本仓 / 框架仓既有闸门执行；本 backlog 单不跑闸门。

## 6. 交付记录路径（实施完成后）

`docs/worklog/completed/phase2.5/af008-framework-evolution-agent-protocol-mapping-implementation-{{YYYY-MM-DD}}.md`

## 7. 回写清单（实施完成后）

- [ ] 交付记录落固定路径；任务单归档成对；wp-list / 阶段入口 / 索引同步回写；
- [ ] 索引状态迁移追加 `history`，工件指针填全；
- [ ] 审计链闭合：`taskId` 贯穿任务单 / 交付记录 / 回执 / commit message。
