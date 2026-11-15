---
taskId: AF-009
contextId: phase2.5-orchestration-closed-loop
title: 交接契约 schema 与 transport 目录接线（tasks / receipts / reviews 三组交接件机读结构）
type: implementation
status: backlog
baselineRef: 09df090
dependsOn: []
policyRefs: [framework/task-contract.md, framework/receipt-contract.md, framework/evolution.md]
createdAt: 2026-11-16
---

# AF-009 · 交接契约 schema 与 transport 目录接线

> 状态：📋 待立项（2026-11-16）｜编排：主控 Doubao（orchestrator 自做）
> 仓库：`E:\Work\Project\backend\mofang-nestjs`；落点 `transport/`、`scripts/orchestration/`、本仓适配层文档
> 唯一事实源：`docs/team/agent-orchestration/autonomous-team-design.md` §3.4（契约文件化）、§8 P0-1
> 任务性质：编排层工具链演进；不碰业务源码（`src/` / `test/` / `bin/` / `admin-dashboard/` / `src/migration/`）

## 0. 【必读入口】动手前按顺序读完

1. `docs/team/agent-orchestration/autonomous-team-design.md`（本批设计备忘：通道、互斥、发布分层、分期）
2. 框架仓 `E:\Work\Project\agent-collaboration-framework\docs\task-contract.md`（任务契约与工件模型）
3. 框架仓 `docs/receipt-contract.md`（回执七组字段骨架）
4. 本仓 `scripts/orchestration/transport.mjs`（现有文件 Transport 与 tasks / receipts / artifacts 子目录实现）
5. 本仓 `docs/team/agent-orchestration/README.md`（目录映射、角色绑定、通用层指针）

## 1. 背景

自主闭环要求交接内容以文件为唯一真相源：GUI 通道只传 taskId 与文件路径，executor 上下文从交接文件重建（对齐框架 `reliability.md` §6 崩溃恢复口径）。现状 `transport.mjs` 已有 `createFileTransport` 写 `transport/{tasks,receipts,artifacts}/<safeName>.json`，但：交接件结构未在本仓固化为显式 schema / 校验；缺协商轮 `reviews/` 子目录；任务契约与回执字段需与框架 `task-sheet.schema.json`、回执七组字段一一映射，避免各通道各写一份口径。

## 2. 范围（严格遵守，不越权）

**在范围内：**

- `transport/tasks/<taskId>.json`：任务契约机读结构（taskId、contextId、title、type、status、baselineRef、dependsOn、policyRefs、scope.files、gate 要求、能力声明要求、工件指针、schemaVersion）；
- `transport/receipts/<taskId>.json`：回执七组字段映射（任务标识 / 落地 / 证据 / 范围 / 契约 / 遗留 / 偏差 / 结论，骨架以框架回执契约为准）；
- `transport/reviews/<taskId>.json`：方案协商轮意见结构（提案要点、风险、替代思路、分歧点、建议决策），orchestrator 裁决后回写结论；
- 字段校验与缺省口径：必填校验、taskId 与文件名一致、工件路径相对仓根校验；契约只增不删，框架既有字段语义不变；
- `transport.mjs` 目录接线补 `reviews/` 子目录；保留 mcp / http Transport 预留位现状，不实现协议适配。

**明确不在范围内：**

- 不改框架 schema 字段集合与语义；通用层不出现项目取值、命令名、业务实体；
- 不实现派发调度逻辑（归 AF-010）、文件域互斥校验（归 AF-011）、分支流程（归 AF-012）；
- 不动业务 `src/` / `test/` / `bin/` / `admin-dashboard/` / migration；不新增生产依赖；
- 不自动 commit / push（实施完成后给 commit 草稿，按分层发布口径由流程决定）。

## 3. 目标架构 / 交付物

- **交付物 1：交接契约结构定义** —— `scripts/orchestration/` 内模块（纯 ESM .mjs）：三组交接件的字段组、必填集、schemaVersion、构造与校验纯函数；口径真相源标注为框架对应 schema 与文档，本仓只做适配层投影，不另抄阈值。
- **交付物 2：Transport 目录接线** —— `transport.mjs` 补 reviews 子目录与读写入口；tasks / receipts / reviews 目录约定写入 README §3 目录映射。
- **交付物 3：测试** —— `scripts/orchestration/__tests__/orchestration.spec.mjs` 增补：三组交接件合法构造通过、缺必填 / taskId 不匹配 / 工件路径越界等负向用例；纯静态 / 单元形态，不起 Nest、不连 DB。

## 4. 红线（违反即返工）

- 契约字段只增不删；向后兼容既有任务单、索引、归档指针格式；
- 规则唯一真相源在框架 schema 与文档，工具不另抄口径；通用层零业务耦合；
- 交接件不含心理对话原文；工件指针只存路径，不复制正文；
- 实施阶段不自动 commit / push；提交分组与闸门按交付标准执行。

## 5. 闸门（实施时填真实数字）

编排层 .mjs 脚本：`pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs`；`pnpm typecheck`；`pnpm lint:fast`；文件编码无 BOM、纯 LF。命令一律 pnpm，禁裸 npx。本立项单不跑闸门。

## 6. 交付记录路径（实施完成后）

`docs/worklog/completed/phase2.5/af009-handover-contract-schema-transport-implementation-{{YYYY-MM-DD}}.md`

## 7. 回写清单（实施完成后）

- [ ] 交付记录落固定路径；任务单与交付记录成对归档；索引 / 阶段入口 / README 目录映射同步回写；
- [ ] 索引状态迁移追加 `history`，工件指针填全；
- [ ] 审计链闭合：`taskId` 贯穿任务单 / 交接件 / 交付记录 / commit message。
