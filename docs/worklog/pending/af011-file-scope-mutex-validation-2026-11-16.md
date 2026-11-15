---
taskId: AF-011
contextId: phase2.5-orchestration-closed-loop
title: 文件域 scope 校验与在办任务交集拦截（双代理文件互斥前置护栏）
type: implementation
status: backlog
baselineRef: 09df090
dependsOn: [AF-009]
policyRefs: [framework/roles.md, framework/reliability.md, framework/task-contract.md]
createdAt: 2026-11-16
---

# AF-011 · 文件域 scope 校验与在办交集拦截

> 状态：📋 待立项（2026-11-16）｜编排：主控 Doubao（orchestrator 自做）
> 仓库：`E:\Work\Project\backend\mofang-nestjs`；落点 `scripts/orchestration/`、任务单 schema 字段口径
> 唯一事实源：`docs/team/agent-orchestration/autonomous-team-design.md` §5（并发与文件域互斥）、§8 P0-3
> 任务性质：编排层工具链演进；不碰业务源码

## 0. 【必读入口】动手前按顺序读完

1. `docs/team/agent-orchestration/autonomous-team-design.md` §5、§8
2. 框架仓 `docs/roles.md` §3（角色隔离硬规则）、§4（资源域划分）
3. 框架仓 `docs/reliability.md` §6（幂等、残留文件识别、崩溃恢复）
4. 框架仓 `docs/task-contract.md`（任务切片与工件模型）
5. 本仓 `scripts/orchestration/scheduler.mjs`、`state-store.mjs`（在办任务读取口径）

## 1. 背景

现状只有任务级租约，无可写文件域前置声明与交集校验：双代理并行时可能同时改同一文件，且验收 / 提交前缺少「改动清单 vs 任务 scope」的残留文件识别。本单落地文件域互斥护栏：任务单前置声明 `scope.files`，派发前与在办任务文件域做交集校验，有交集则排队或冻结，不并行派发；验收侧比对 git diff 文件清单与 scope，清单外文件判残留。

## 2. 范围（严格遵守，不越权）

**在范围内：**

- 任务单 `scope.files` 字段口径：可写文件 / 目录数组，相对仓根；通配与目录边界规则；
- 派发前交集校验：与在办（submitted / working）任务 scope 求交集；交集非空 → 拦截派发、任务留 ready 或转冻结，写审计与原因；
- 验收残留识别：git diff 文件清单与 scope 比对；清单外文件判残留，不进提交分组；发现他人未提交改动交叉 → 暂停转人工；
- 角色资源域基线：orchestrator 资源域（`scripts/orchestration/`、`docs/team/agent-orchestration/`、worklog）与 executor 资源域（`src/`、`test/`、pending 切片）在任务单校验中作为默认边界；
- 只读调研类任务与实现类任务的互斥口径区分（只读不占写域）。

**明确不在范围内：**

- 多代理并行调度器与文件锁升级（P2，本单只做单队列下的前置校验与残留识别）；
- 不改角色卡既有职责划分；不实现跨机器 / 跨进程文件锁；
- 不动业务 `src/` / `test/`；不新增生产依赖；不自动 commit / push。

## 3. 目标架构 / 交付物

- **交付物 1：scope 校验纯函数** —— 文件域归一化（相对路径、目录前缀、通配展开）、交集计算、残留比对；纯函数、无 IO 副作用，便于单测；
- **交付物 2：调度拦截接线** —— claim / 派发前置调用校验；拦截结果进状态与审计；在办任务集合读取经现有 Store 端口；
- **交付物 3：测试** —— 交集命中 / 无交集 / 目录前缀包含 / 通配边界 / 只读任务豁免 / 残留文件识别等用例；纯单元形态。

## 4. 红线（违反即返工）

- 校验只做机读可判定项；人工判断的范围分歧转冻结 / 人工，不伪装机器结论；
- 资源域边界真相源在角色卡与框架 roles.md，工具不另抄规则；
- 残留文件不自动删除、不自动归入本单提交；只识别与报告；
- 实施阶段不自动 commit / push。

## 5. 闸门（实施时填真实数字）

`pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs`；`pnpm typecheck`；`pnpm lint:fast`；编码无 BOM、纯 LF；pnpm 强制。本立项单不跑闸门。

## 6. 交付记录路径（实施完成后）

`docs/worklog/completed/phase2.5/af011-file-scope-mutex-validation-implementation-{{YYYY-MM-DD}}.md`

## 7. 回写清单（实施完成后）

- [ ] 交付记录落固定路径；任务单与交付记录成对归档；索引 / 阶段入口同步回写；
- [ ] 索引状态迁移追加 `history`，工件指针填全；
- [ ] 审计链闭合：`taskId` 贯穿任务单 / 校验记录 / 交付记录 / commit message。
