---
taskId: AF-010
contextId: phase2.5-orchestration-closed-loop
title: 派发接线（claim 接 submitTask、派发记录落盘、watcher 监听 receipts 触发验收轮）
type: implementation
status: backlog
baselineRef: 09df090
dependsOn: [AF-009]
policyRefs: [framework/state-machine.md, framework/reliability.md, framework/autonomous-loop.md]
createdAt: 2026-11-16
---

# AF-010 · 派发接线：claim → submitTask → 派发记录 → 回执监听

> 状态：📋 待立项（2026-11-16）｜编排：主控 Doubao（orchestrator 自做）
> 仓库：`E:\Work\Project\backend\mofang-nestjs`；落点 `scripts/orchestration/`、`transport/`
> 唯一事实源：`docs/team/agent-orchestration/autonomous-team-design.md` §2（闭环链路③④⑤）、§3.5（派发审计）、§8 P0-2
> 任务性质：编排层工具链演进；不碰业务源码

## 0. 【必读入口】动手前按顺序读完

1. `docs/team/agent-orchestration/autonomous-team-design.md` §2、§3.5、§8
2. 框架仓 `docs/state-machine.md`（九态枚举、有效迁移、终态不可变）
3. 框架仓 `docs/reliability.md`（租约、超时释放、重试与失败定性、崩溃恢复）
4. 框架仓 `docs/autonomous-loop.md`（循环阶段、冻结动作表）
5. 本仓 `scripts/orchestration/scheduler.mjs`（现有 claimReadyTasks、租约、超时释放、验收驱动）、`file-watcher.mjs`（现有 pending / completed 防抖监听）、`transport.mjs`

## 1. 背景

现状 `claimReadyTasks` 只登记租约，不产生派发记录；`transport.submitTask` 未被调度链路调用；`file-watcher.mjs` 只监听 `docs/worklog/pending` 与 `docs/worklog/completed`，未监听 `transport/receipts`，回执落盘后不能自动触发验收轮。本单把「领取租约 → 写任务交接件 → 派发记录留痕 → 回执事件触发验收」链路接通，使闭环从 cron 人工轮询走向事件驱动（事件通道替代轮询属 P1，本单先落文件事件监听与触发入口）。

## 2. 范围（严格遵守，不越权）

**在范围内：**

- 调度链路：claim 成功后经 Transport 写 `tasks/<taskId>.json`，生成派发记录（通道、目标角色、会话路径、派发时间、租约、状态）落审计 / 索引；
- 状态迁移对接既有状态机：`ready → submitted → working` 的迁移点、租约字段、超时释放沿用 scheduler 现有实现，不新增状态枚举；
- watcher 扩展监听 `transport/receipts/`（防抖口径沿用现有 300ms）；回执落盘事件进入验收触发入口（验收 runner 调用沿用 AF 既有 `acceptance-runner.mjs`）；
- 派发审计条目：通道、尝试次数、结果、时间戳，写现有工具审计日志；
- 幂等：重复派发同一 taskId + 版本不重复执行；回执重复投递只触发一次验收。

**明确不在范围内：**

- 文件域 scope 交集校验（归 AF-011）；GUI 自动化操作与演练（归 AF-013）；任务分支流程（归 AF-012）；
- 不改状态枚举与迁移表语义；不实现 MCP / HTTP 传输；不接远端 CI 状态；
- 不动业务 `src/` / `test/` / `bin/`；不新增生产依赖；executor 不提交、不推送。

## 3. 目标架构 / 交付物

- **交付物 1：派发链路模块** —— scheduler / CLI 内接线：claim → submitTask → 派发记录；失败定性与租约释放口径对齐可靠性规范；
- **交付物 2：回执事件监听** —— file-watcher 增 receipts 目录监听与验收触发钩子；事件去重与幂等键（taskId + 工件版本）；
- **交付物 3：测试** —— 增补用例：派发记录落盘字段齐全、回执事件触发验收入口、重复回执幂等不重复验收、租约超时释放不被派发绕过；纯单元 / 静态形态。

## 4. 红线（违反即返工）

- 状态迁移只走既有九态与迁移表；终态任务不可再迁移；
- 派发记录与审计只留指针、通道与计数，不含对话原文；
- 交接件 schema 以 AF-009 落地结构为准；本单不另立字段口径；
- 实施阶段不自动 commit / push。

## 5. 闸门（实施时填真实数字）

`pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs`；`pnpm typecheck`；`pnpm lint:fast`；编码无 BOM、纯 LF；pnpm 强制。本立项单不跑闸门。

## 6. 交付记录路径（实施完成后）

`docs/worklog/completed/phase2.5/af010-dispatch-wiring-receipt-watcher-implementation-{{YYYY-MM-DD}}.md`

## 7. 回写清单（实施完成后）

- [ ] 交付记录落固定路径；任务单与交付记录成对归档；索引 / 阶段入口同步回写；
- [ ] 索引状态迁移追加 `history`，工件指针填全；
- [ ] 审计链闭合：`taskId` 贯穿任务单 / 交接件 / 派发记录 / 交付记录 / commit message。
