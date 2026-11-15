---
taskId: AF-005
contextId: framework-evolution
title: 框架 L2 演进 —— watcher 与状态机自动化（状态持久化后由持久层承接状态机与重试）
type: implementation
status: backlog
baselineRef: 3a28da6
dependsOn: []
policyRefs: [framework/evolution.md, framework/state-machine.md, framework/reliability.md]
createdAt: 2026-11-15
---

# AF-005 · 框架 L2 演进 —— watcher 与状态机自动化（backlog · 触发后立项实施）

> 状态：📋 backlog（2026-11-15）｜编排：主控 Doubao｜执行方：待定（触发时派发）
> 仓库：本仓 `E:\Work\Project\backend\mofang-nestjs`（adapter 侧登记）；实现落点预期为框架仓 `E:\Work\Project\agent-collaboration-framework`
> 任务性质：框架演进项；本单当前**不实现**，仅立项登记；触发条件满足后另开 ready 子单实施。

## 0. 【必读入口】动手前按顺序读完

1. 框架仓 `docs/evolution.md` §2 四级路线（L2 状态持久化档触发条件与不变项）
2. 框架仓 `docs/state-machine.md`（九态枚举、迁移规则、终态不可变）
3. 框架仓 `docs/reliability.md`（领取租约、超时释放、重试与失败定性、崩溃恢复）
4. 框架仓 `docs/task-contract.md`（任务契约与工件模型）
5. 本仓适配层 `docs/team/agent-orchestration/README.md`（目录映射、角色绑定、通用层指针）

## 1. 背景

当前框架为 L0 形态：任务状态落在文件索引（`task-state-index.json`），编排靠平台 cron 定时轮询回执文件；状态迁移、租约到期释放、重试承接均由主控在编排流程里手工 / 半手工驱动。AF-004 交付记录遗留 AF-004-L2 已明确：分钟级自适应 watcher 与状态机自动化属框架 L2 以上演进，L0 任务单不实现。

框架 `evolution.md` L2 档规定：任务量 / 并发超出文件索引上限、或多会话需共享状态时，状态索引迁入数据库或工作流引擎，**状态机与重试由持久层承接**。本单登记该演进方向，不替代 L0 既有文件 + cron 闭环。

## 2. 范围（严格遵守，不越权）

**触发后在范围内（预期）：**

- watcher / 监听机制设计：回执 / 工件落盘事件到状态迁移的自动触发通道；
- 状态机自动化：状态迁移、续租约、超时释放、失败重试在持久层自动承接的设计与实现；
- 状态持久化存储迁移：状态索引由 JSON 文件迁入具备事务、并发锁、租约、可查询能力的存储（数据库或工作流引擎）；
- L0 与 L2 之间的迁移路径与向后兼容（既有任务单、索引、归档指针格式不破坏）。

**明确不在范围内：**

- 不改框架 schema 既有字段语义、不删除字段；新增能力只以附加字段承载；
- 不动本仓业务代码（`src/` / `test/` / `bin/` / `scripts/`）；
- 不替代 / 旁路 L0 既有文件 + cron 闭环；
- 通用层不得出现项目取值、命令名、路径或业务实体。

## 3. 目标架构 / 交付物（触发后立项时细化）

- 演进设计备忘：触发条件判定、watcher 选型、持久层存储选型（事务 / 并发锁 / 租约 / 可查询）、状态机 / 重试承接方案、L0 → L2 迁移与回滚路径；
- 框架仓对应规范 / 代码 / 配置（若进入实现阶段）；
- 验收：框架两类 schema 校验通过；五类验收留证；既有 L0 闭环回归不破坏。

## 4. 红线（违反即返工）

- 契约只增不删；状态枚举、工件模型向后兼容；
- 通用层零业务耦合（目录名 / 命令 / 工具名 / 业务实体 / 任务标识只允许出现在适配层）；
- 终态不可变；返修沿用同一 `contextId` 新开任务，不新增返修关联字段；
- 实施阶段不自动 commit / push；提交分组与闸门按交付标准执行。

## 5. 闸门（触发后实施时填真实数字）

实施子单按框架 `docs/acceptance.md` 五类核对 + 本仓 / 框架仓既有闸门执行；本 backlog 单不跑闸门。

## 6. 交付记录路径（实施完成后）

`docs/worklog/completed/phase2.5/af005-framework-evolution-watcher-state-machine-implementation-{{YYYY-MM-DD}}.md`

## 7. 回写清单（实施完成后）

- [ ] 交付记录落固定路径；任务单归档成对；wp-list / 阶段入口 / 索引同步回写；
- [ ] 索引状态迁移追加 `history`，工件指针填全；
- [ ] 审计链闭合：`taskId` 贯穿任务单 / 交付记录 / 回执 / commit message。
