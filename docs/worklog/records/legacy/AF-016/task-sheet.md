---
taskId: AF-016
contextId: phase2.5-orchestration-closed-loop
title: 编排闭环护栏补全（Agent Card 能力路由 / 资源域越域校验 / 分支 rebase 巡检 / V7 残留采集接线）
type: implementation
status: completed
baselineRef: 2191d06
dependsOn: [AF-010, AF-011, AF-012]
policyRefs: [framework/agent-card.schema, autonomous-team-design.md#routing-scope-domain]
createdAt: 2026-11-16
---

# AF-016 · 编排闭环护栏补全

> 状态：✅ 已交付（2026-11-16）｜编排：主控 Doubao（orchestrator 自做）｜交付记录：af016-agent-card-routing-scope-domain-rebase-residual-implementation-2026-11-16.md
> 仓库：`E:\Work\Project\backend\mofang-nestjs`；落点 `scripts/orchestration/card-router.mjs`（新）、`dispatch.mjs`、`scope-mutex.mjs`（复用）、`branch-workflow.mjs`、`scheduler.mjs`、`cli.mjs`、`state-store.mjs`、`__tests__/orchestration.spec.mjs`、设计备忘 §3.6 / §4.2 / §5
> 唯一事实源：Agent Card `skills` / `tools` / `resources` / `availability` 声明与框架 `roles.md`；本仓 `autonomous-team-design.md` §3.6（路由与资源域）、§4.2（巡检）、§5（残留识别）
> 任务性质：adapter 层纯函数 + 注入接线 + 单测 + 活文档口径；零业务源码改动、零进程 / 剪贴板 IO、零新增依赖

## 0. 【必读入口】动手前按顺序读完

1. 本仓 `docs/team/agent-orchestration/agent-cards/` 三份角色卡字段（role / skills / tools / resources / limits / availability）
2. `scripts/orchestration/` 既有模块：`dispatch.mjs`（派发记录）、`scope-mutex.mjs`（文件域互斥与残留识别）、`branch-workflow.mjs`（分支流程与巡检）、`acceptance-runner.mjs`（V1–V7 护栏）、`scheduler.mjs`（状态机）、`cli.mjs`（入口）
3. 改进台账 IM-008 / IM-009 / IM-010 / IM-013 条目原文与建议
4. 设计备忘 §3.6、§4.2、§5 现状口径

## 1. 背景

台账四条编排闭环缺口：派发目标角色未按 Agent Card 能力声明匹配（IM-008）；任务 scope 未与角色 `resources` 资源域做越域校验（IM-010）；分支巡检未判定未合并分支是否落后基线（IM-013）；验收残留比对缺 git diff 采集器，V7 长期 skip（IM-009）。本单在 adapter 层把四条缺口补为纯函数护栏，调度与 CLI 仅做注入接线；资源域与能力声明真相源保持角色卡与框架 `roles.md`，脚本不另抄目录白名单。

## 2. 范围（严格遵守，不越权）

**在范围内：**

- **IM-008 能力路由**：新增 `card-router.mjs` 的 `matchAgentCard` / `selectTargetRole`——`availability` 非 `available` 不入选；按 `skills` / `tools` 命中交集评分；显式指定角色优先，显式角色不可用时保留该角色并透出原因，不擅自改派；无显式角色按能力匹配；匹配明细随派发记录 `route` 透出。`dispatchTask` 增 `cards` 注入，未传时保持原显式 / `agentRole` 口径。
- **IM-010 资源域越域校验**：`validateScopeDomain(task, cards, opts)`——`scope.files` 逐条校验是否落在目标角色 Card `resources` 前缀内，越域清单透出并由调度拦截；只读 / 调研 / 评审 / 验证类豁免。`state-store.loadAgentCards` 投影补 `resources` 字段。
- **IM-013 rebase 巡检**：`classifyBranches` / `planCleanup` 增 `aheadBy` / `behindBy` 输入与 `needsRebase` 分类；未合并且 `behindBy>0` 单独标注待 rebase，不与超期 stale 混同；git 端口增 `aheadBehind(name, base)`；CLI 巡检采集并输出。
- **IM-009 残留采集接线**：`branch-workflow.mjs` 增 git 端口 `changedFiles()` 与纯函数 `collectChangedFiles`；run-once / watch 入口采集 `git diff --name-only HEAD` 传入 `advanceOnce` → `processReceipts` → `runAcceptance` 的 `changedFiles`，激活 V7；清单为空时 V7 仍记 skip。
- 单测：覆盖能力评分与门槛、显式回落、资源域内 / 越域 / 只读豁免 / 缺卡 / 无 resources、needsRebase 分类与旧对象兼容、采集器过滤与容错、dispatch 路由接线与向后兼容。
- 设计备忘：§3.6 新增路由与资源域护栏口径；§4.2 补 rebase 标注；§5 补采集入口接线；§6.4 追加 AF-016 同步记录。
- 台账：IM-008 / IM-009 / IM-010 / IM-013 流转终态，关联 AF-016。

**明确不在范围内：**

- 不实现并行文件锁升级与真实目录 glob 展开（IM-011，P2）；不补交接件独立工件版本号（IM-007）；不复用框架 schema 消除契约镜像（IM-005）；review 交接件结构上提框架仓（IM-006，跨仓）。
- 不清算业务依赖技术债：typeorm-model-generator 移除（IM-002）、传递依赖升级（IM-003）；不接入远端 CI 门禁（IM-018）；不执行 `development` 分支退役（IM-019）；熔断阈值参数化（IM-017，P2）。
- 不改业务 `src/`、`test/`、配置与依赖；进程 / 窗口 / 剪贴板 IO 仍留注入接口位，模块内零 IO。

## 3. 目标架构 / 交付物

- **交付物 1：角色卡路由与资源域纯函数** —— `card-router.mjs`；纯函数可替身单测。
- **交付物 2：分支 rebase 分类与变更清单采集器** —— `branch-workflow.mjs` 扩展；git IO 经注入端口。
- **交付物 3：调度 / CLI 注入接线 + 单测** —— `scheduler.mjs` / `cli.mjs` 透传 cards 与 changedFiles；编排层 vitest 全绿。
- **交付物 4：备忘口径与台账闭环** —— §3.6 / §4.2 / §5 / §6.4；四条台账流转 done。

## 4. 红线（违反即返工）

- 资源域与能力声明只消费角色卡 / 框架 `roles.md`，脚本不另抄目录白名单；任务间文件域互斥仍归 `scope-mutex.mjs`，与角色资源域校验并存不混同。
- 显式角色不可用时不得擅自改派到其他角色；匹配失败原因必须透出。
- 既有导出签名与行为向后兼容：未传 `cards` / 未传 `changedFiles` 时维持原口径（route 为 null、V7 skip）。
- JSON 无 BOM、纯 LF；历史交付记录与已归档文档只读不改；不把过渡口径写成永久设计。

## 5. 闸门（实施时填真实数字）

编排层定向 vitest；`pnpm lint:fast`；CLI `validate`（索引 / 工具契约 / 三角色卡 schema）；JSON `Test-Json`；编码探测（BOM / CR）；`git diff --stat HEAD -- src test` 为空。纯函数 / 文档单不跑全量 typecheck（改动不进入 `src/test` 运行时），在交付记录注明。pnpm 强制；本立项单不跑闸门。

## 6. 交付记录路径（实施完成后）

`docs/worklog/completed/phase2.5/af016-agent-card-routing-scope-domain-rebase-residual-implementation-{{YYYY-MM-DD}}.md`

## 7. 回写清单（实施完成后）

- [ ] 交付记录落固定路径；任务单与交付记录成对归档；索引 / 快照 / 看板 data.js / 阶段入口 README 同步回写；
- [ ] 四条台账（IM-008 / 009 / 010 / 013）逐条映射到落地函数与测试用例；保留项（IM-005 / 006 / 007 / 011 / 017 / 018 / 019）在交付记录列清；
- [ ] 审计链闭合：`taskId`（AF-016）贯穿任务单 / 交付记录 / 台账关联 / commit message。
