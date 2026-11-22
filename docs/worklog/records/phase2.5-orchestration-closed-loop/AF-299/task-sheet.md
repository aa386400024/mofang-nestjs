---
taskId: AF-299
contextId: phase2.5-orchestration-closed-loop
title: R6-D3 Lite 原生评分 prompt V2 与 6 packet 小筛（AF-295 号段冲突后重发）
type: implementation
status: backlog
baselineRef: eb30f22f
dependsOn: [AF-227]
priorTasks: [AF-231]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T18:42:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - bin/
    - test/auto-practice/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af299-lite-prompt-v2-2026-11-22.md
    kind: report
  - name: 6 packet 小筛报告
    path: data/phase25-exit/af229-lite-dev-12/v2-screen6/report.json
    kind: dataset
gates:
  - command: pnpm exec vitest run test/auto-practice/af229-lite-prompt.spec.ts test/auto-practice/af299-lite-prompt-v2.spec.ts
    check: Lite prompt V1 保留与 V2 契约单测全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型闭合
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量回归
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: 输出为空
successCriteria:
  - 新增 lite-rubric-v2，V1 保留可 A/B，不改共享 prompt 与既有评分阈值。
  - V2 按 AF-231 交付记录 6.1 阶梯整体下移：5 分命中 5 分档 4 条且无 1 分档；4 分恰好 3 条；3 分 ≤2 条；2 分命中 1 分档 1 条；1 分 ≥2 条。
  - 五维全 4 时触发最弱维复核：有 1 分档压到 2/1；5 分档 ≤2 条压到 3；最弱维稳定 3 条才保留 4。
  - overall 跟最突出维度/最低维/中位数，不取平均。
  - 五维最多 2 维给 5 分；输出仍是 AF-214 行协议，解析器无需改动。
  - 用 baseline 分歧最大的 6 个 packet 小筛：10ce、836f、8898、7bca、685b、7517。
  - 小筛门槛：跨模型 κ ≥0.4、绝对差 ≤0.3、std ≥0.5、唯一分数 ≥3、4 分占比 <70%、reasoning ≤1.3x baseline。
  - 6 packet 过门才跑 12 packet；不过门则停止加规则并如实记录负结果，不跑 24/48。
  - 交付记录、机读回执、归档与受保护 PR 齐全。
---
# AF-299 · R6-D3 Lite 原生评分 prompt V2 与 6 packet 小筛

## 背景

AF-231 的 `lite-rubric-v1` 在 12 packet 开发集上 22/24 个 4 分，跨模型 κ 0.333333、std 0.438986，未过预登记门槛，V1 冻结。AF-231 交付记录 §6.1–§6.3 给出 V2 方案：阈值整体下移、反全 4 默认、overall 跟最突出维度。

本任务原登记为 AF-295，并已在 `8fedf002` 基线上完成实现与 6 packet 小筛；但并行进程在 `integrate` 上先用 AF-295 号段交付了“smoke 双候选故障注入”（commit `bbc48ee4`）并归档。两条状态链在同号段上分叉，按“号段不复用、状态面不可手改”规则，本轮在新基线 `eb30f22f` 上重发为 AF-299，保留原实验结果与代码，不覆盖已归档的 AF-295。

## 目标

1. 新增 `lite-rubric-v2`，V1 原样保留，支持 A/B。
2. 按 AF-231 交付记录 §6.1–§6.3 实现阈值下移、全 4 反默认、overall 跟最突出维度。
3. 先跑 6 packet 小筛，只在小筛过门后才扩 12 packet；不跑 24/48。
4. 如实记录分数分布、κ、绝对差、std、reasoning 倍数与负结果。

## 非目标

- 不改共享 `buildRealismRaterPrompt`、AF-214 行协议、既有评分阈值。
- 不改 `src/engine-core/**`、`admin-dashboard/`、Flutter。
- 不做真人督导双标，不声称临床达标。
- 不改 V5 引擎渲染路径、AF-278 遥测、AF-296–AF-298 渲染比率修正。

## 边界

- 只改 `bin/`、`test/auto-practice/`、交付记录与记录包。
- 模型身份、评分员身份不写入评分输入；R1/R2 仍只作通道标签。
- 6 packet 不过门即停，不继续烧 token。

## 验收

- V2 prompt 契约测试覆盖 5/4/3/2/1 阈值、全 4 复核、overall 规则、5 分上限与行协议。
- 6 packet 小筛报告落盘；门槛逐条给结果。
- 若过门，补 12 packet 开发集结果；若不过门，交付记录写明停止理由。
- 定向测试、lint、typecheck、全量测试全绿。
- 交付记录含六组机读字段标记。
