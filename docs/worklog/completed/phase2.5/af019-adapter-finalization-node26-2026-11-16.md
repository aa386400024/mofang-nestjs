---
taskId: AF-019
contextId: phase2.5-orchestration-closed-loop
title: 适配层收尾：development 分支退役、CI 运行时升级与记录闭环
type: implementation
status: completed
baselineRef: 355aae6
dependsOn: [AF-018]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#2.4, autonomous-team-design.md#4.4]
createdAt: 2026-11-16T21:30:00+08:00
---

# AF-019 · 适配层收尾：development 退役、CI 运行时升级与记录闭环

> 状态：已交付（2026-11-16）｜编排：主控 Doubao（orchestrator 自做）｜交付记录：af019-adapter-finalization-node26-implementation-2026-11-16.md
> 仓库：`D:\work\Project\backend\mofang-nestjs`；落点 `.github/workflows/ci.yml`、`docs/team/agent-orchestration/`、`docs/worklog/`
> 上游：AF-018 适配层迁移完成后的收尾事项；框架仓 `v2.0.0` 口径不变

## 1. 背景

AF-018 已把适配层迁到框架 v2.0.0；随后两批改动完成旧口径清理与 Node 26 基线，CI 首次在真实分支触发并暴露跨仓硬依赖，修复后转绿。此时仍有三项收尾未闭环：

1. `development` 分支仍由 CI push 触发，退役流程已核实但未执行；
2. GitHub Actions 仍使用 Node 20 运行时的 v4 action，产生弃用 warning；
3. 三批提交没有独立工作记录，AF-018 记录停留在迁移当时的 34 条 / 6/6 / 129。

本单把三项收尾一次性闭环，并保留既有实现进度与历史记录只读纪律。

## 2. 范围

**在范围内：**

- 分支：按 `autonomous-team-design.md` §4.4 复核后删除本地与远端 `development`；CI push 触发收敛为 `master` / `integrate`；`IM-019` 流转至 done。
- CI：`checkout` / `setup-node` / `cache` 升 v5，`upload-artifact` 升 v6，`setup-buildx-action` 升 v4，`trivy-action` 固定 `v0.36.0`；补 `package-manager-cache: false` 解决 setup-node v5 在 corepack 前调用 pnpm 的失败。
- 记录：新增 AF-019 任务单与交付记录；索引归档条目与 `archivedNotes` 各补一条；快照 / 看板重生成；工作记录入口登记 AF-019。
- 本机运行时：核实真实 PATH 的 Node 26 基线；不引入 pnpm 9.15 不支持的 `devEngines.runtime` 声明。

**明确不在范围内：**

- 不改 `src/` 业务源码、依赖、migration；不改框架仓；不重写历史交付记录。
- 不删除用户未跟踪设计稿 `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md`。
- 不执行 `master` 合并、tag、release、部署（L4 人工）。

## 3. 交付物

1. `development` 本地与远端删除记录；CI 触发分支收敛；`IM-019` done 留痕。
2. GitHub Actions 全部升级到 Node 24 运行时版本，CI run 绿灯且无 warning 注解。
3. AF-019 任务单 + 交付记录；索引 36 条归档 / 11 条说明；快照与 `data.js` 重生成。
4. `cli validate` 7/7 PASS；编排层 130 passed；全量闸门真实数字回写交付记录。

## 4. 红线

- 删除 `development` 前必须满足：独有非 merge 提交为 0、`git diff integrate...development` 为空；删除为不可逆外部动作，已获用户明确拍板。
- 归档条目只保留 `taskId / status / artifacts`；说明放 `archivedNotes`，不改写既有 35 条。
- 不新增依赖；不把过渡方案写成永久设计；CI action 使用稳定主版本，不回退到浮动 `master`。
- 历史交付记录只读；AF-018 记录不回改，收尾事实落 AF-019。

## 5. 交付回写清单

- [x] `development` 本地与远端删除
- [x] CI push 触发收敛 `master` / `integrate`
- [x] `IM-019` candidate → queued → accepted → done
- [x] GitHub Actions 升级并消除 Node 20 warning
- [x] AF-019 任务单与交付记录
- [x] 索引归档条目 + `archivedNotes` + 快照 / 看板重生成
- [x] `cli validate` 7/7、编排层 130 passed、全量闸门证据
