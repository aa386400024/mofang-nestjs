---
taskId: AF-012
contextId: phase2.5-orchestration-closed-loop
title: 任务分支流程脚本（建分支 / squash 合并 / 合并清理 / 陈旧分支巡检）
type: implementation
status: backlog
baselineRef: 09df090
dependsOn: []
policyRefs: [framework/state-machine.md, autonomous-team-design.md#branch-strategy]
createdAt: 2026-11-16
---

# AF-012 · 任务分支流程脚本与分支数量治理

> 状态：📋 待立项（2026-11-16）｜编排：主控 Doubao（orchestrator 自做）
> 仓库：`E:\Work\Project\backend\mofang-nestjs`；落点 `scripts/orchestration/`、CLI 子命令
> 唯一事实源：`docs/team/agent-orchestration/autonomous-team-design.md` §4（分支策略与治理）、§6（分层发布）、§8 P0-4
> 任务性质：编排层工具链演进；不碰业务源码

## 0. 【必读入口】动手前按顺序读完

1. `docs/team/agent-orchestration/autonomous-team-design.md` §4、§6、§8
2. 框架仓 `docs/state-machine.md`（任务终态与归档口径）
3. 本仓 `.husky/pre-commit`、`.husky/commit-msg`（既有提交钩子与 conventional 格式约束）
4. 本仓 `scripts/orchestration/cli.mjs`（现有子命令结构、工具审计登记方式）
5. 现状分支取证：长期 `master`（默认）、`integrate`（流水线落点）；`development` 退役另案（见 §2）

## 1. 背景

现状所有提交直接落在 `integrate`，无任务分支；设计备忘定稿采用精简 Git Flow：长期分支 `master`（受保护）+ `integrate`（集成落点），短期任务分支 `task/<taskId>-<slug>`，一单一分支，验收通过后 squash 合并回 integrate，合并即删本地与远端源分支。本单把这套流程固化为 CLI 脚本与巡检工具，防止分支堆积；executor 不建分支、不提交、不推送，分支动作由 orchestrator 侧流程执行。

## 2. 范围（严格遵守，不越权）

**在范围内：**

- 建分支：从 `integrate` 最新 HEAD 切出 `task/<taskId>-<slug>`；基线 ref 写入任务记录；分支名必须含 taskId，命名不合规拒绝创建；
- squash 合并：任务验收五类通过 + 本地闸门绿后，squash merge 回 `integrate`，一个任务一个提交，提交标题 conventional、带 taskId；冲突在任务分支内解决，不产生 merge commit；
- 合并清理：合并成功后删除本地与远端源分支；`archivedTasks` 条目记录分支名，归档时触发清理；
- 陈旧分支巡检：列出「已合并进 integrate」的本地 / 远端分支供一键清理；未合并分支保留并标注超期；不自动删除未合并分支；
- 回退接线：按 taskId 定位提交，首选 `git revert`；未推送分支可删除重来；分支操作日志进工具审计；
- `development` 退役为独立事项：退役前 `git diff integrate..development` 复核为空（现有 4 条独有提交均为历史 PR merge），本单只提供巡检 / 口径，不执行删除。

**明确不在范围内：**

- 远端 PR 流程与 CI 状态门禁（本机无 gh CLI / token，P2 接入）；
- master 合并、tag、release、对外部署（L4，冻结动作，人工）；
- 不改业务代码；不新增生产依赖；脚本内 git 操作只作用于任务分支与 integrate，不触碰 master。

## 3. 目标架构 / 交付物

- **交付物 1：分支流程 CLI** —— 建分支 / squash 合并 / 清理 / 巡检子命令；参数含 taskId、slug、基线 ref；前置校验（分支不存在、工作区无未归属改动、闸门与验收状态）；
- **交付物 2：分支治理台账口径** —— 分支名 ↔ taskId ↔ 归档任务条目映射；巡检输出已合并 / 未合并 / 超期三类；
- **交付物 3：测试** —— 命名合规校验、已合并判定、清理只删已合并分支、未合并不误删等纯函数用例；git 交互部分以替身 / 注入方式隔离，不起真实远端。

## 4. 红线（违反即返工）

- 不跳过提交钩子（禁 `--no-verify`）；不改写已推送历史；回退首选 revert；
- 分支操作可逆：删除前必须确认已合并；未合并分支只报告不删除；
- L4 动作（master / tag / release）不在脚本自动路径内；
- 实施阶段不自动 commit / push；脚本默认干跑校验，实际 push 按分层发布口径执行。

## 5. 闸门（实施时填真实数字）

`pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs`；`pnpm typecheck`；`pnpm lint:fast`；编码无 BOM、纯 LF；pnpm 强制。本立项单不跑闸门。

## 6. 交付记录路径（实施完成后）

`docs/worklog/completed/phase2.5/af012-task-branch-workflow-scripts-implementation-{{YYYY-MM-DD}}.md`

## 7. 回写清单（实施完成后）

- [ ] 交付记录落固定路径；任务单与交付记录成对归档；索引 / 阶段入口 / README 目录映射同步回写；
- [ ] 索引状态迁移追加 `history`，工件指针与分支名填全；
- [ ] 审计链闭合：`taskId` 贯穿任务单 / 分支记录 / 交付记录 / commit message。
