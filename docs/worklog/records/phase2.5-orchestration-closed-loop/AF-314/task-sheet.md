---
taskId: AF-314
contextId: phase2.5-orchestration-closed-loop
title: 自动对练场次卡片展示对练时间与来访者/咨询师模型
type: implementation
status: backlog
baselineRef: 137bbe28de4600b168a721f83c5ec05f56d21549
dependsOn: []
priorTasks: [AF-313]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T22:05:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - src/auto-practice/
    - src/engine-adapters/wiring/
    - src/migration/
    - bin/
    - test/auto-practice/
    - test/engine-adapters/
    - admin-dashboard/src/
    - docs/worklog/pending/
    - docs/worklog/completed/
    - docs/worklog/records/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af314-practice-session-model-display-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/practice-runner.spec.ts test/auto-practice/practice-runner-cost.spec.ts test/engine-adapters/wp8-wiring.spec.ts
    check: 自动对练持久化 + 渲染装配回归全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 后端类型闭合
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm --dir admin-dashboard type-check
    check: 管理台 Vue/TS 类型闭合
    threshold: exit=0
  - command: pnpm test
    check: 全量回归
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: 输出为空
successCriteria:
  - 自动对练场次卡片直接展示对练开始时间、时长与成本；运行中场次时长实时按当前时间计算，不显示伪结束时间。
  - 卡片展示来访者模型与咨询师模型；字段来自会话启动时真实装配的渲染主候选与咨询师生成模型，不再把 MINIMAX_LLM_MODEL 当作整场唯一模型。
  - ap_practice_sessions 新增 visitor_model_provider / visitor_model / counselor_model 三列，migration 在 bin/ormconfig.ts 与 src/migration/index.ts 双注册，历史行保持 NULL 并在前端降级显示既有 modelVersion。
  - 卡片保留既有轮次、模式、接触方式、危机结论，不引入拥挤换行；完整模型 ID、退出原因、批次、种子、成本放入悬浮提示。
  - 历史场次与新场次均可正常渲染，不因新增列或空值报错；不展示任何对话原文。
  - migration 可在远程 MySQL 幂等执行，执行后新场次写入三列成功。
  - 定向测试、后端 lint/typecheck、管理台 type-check、全量测试全绿；engine-core 零改动。
  - 交付记录、机读回执、归档与受保护 PR 齐全。
---

# AF-314 · 自动对练场次卡片展示对练时间与来访者/咨询师模型

## 背景

`/auto-practice` 的历史场次卡片目前只显示轮次、咨询师模式、接触方式与危机结论，运营看不到这场对练发生在什么时候、跑了多久、用了什么模型。

后端 `PracticeSession` 与列表接口已经返回 `startedAt`、`finishedAt`、`modelVersion`、`totalCost`、`exitReason`、`batchId`、`seedValue`。但 `modelVersion` 的来源是 `InferenceFingerprint.model`，实际取 `MINIMAX_LLM_MODEL`（当前为 `MiniMax-M3`）；而本机 `VISITOR_LLM_PROVIDER=doubao`、`VISITOR_DOUBAO_MODEL=doubao-seed-character-260628`，来访者渲染主模型实际是豆包。因此直接把 `modelVersion` 标成“模型”会把 MiniMax 引擎模型误当成整场对练的真实来访者模型。

## 目标

1. 在自动对练左栏卡片增加对练时间、时长、成本，以及来访者模型、咨询师模型。
2. 会话启动时把真实装配的渲染主候选（provider + chat 模型）与咨询师生成模型落库，避免运行后配置漂移导致历史不可追溯。
3. 历史行没有新列时，前端降级展示既有 `modelVersion`，并明确标为引擎模型语义，不伪造历史模型。
4. 完整模型 ID、退出原因、批次、种子、成本等辅助信息放入悬浮提示，保证卡片本身不拥挤。
5. 配套 migration、实体列、测试、迁移双注册、交付记录与受保护 PR。

## 非目标

- 不改 `src/engine-core/**`、Flutter 客户端。
- 不改批量对比的既有 `modelVersion` 语义，也不回填历史行。
- 不做逐轮模型切换历史；本轮只固定会话启动时的主候选与实际咨询师模型。
- 不改自动对练循环、危机判定、评分口径。

## 边界

- 后端只改 `src/auto-practice/`、`src/engine-adapters/wiring/` 的必要只读出口、`src/migration/`、`bin/`、测试与 worklog。
- 管理台只改 `admin-dashboard/src/` 的自动对练卡片、类型与辅助格式化。
- 不打印任何对话原文；日志只出 session id、模型标识与错误类型名。
- 新增列全部 nullable，历史行与旧部署可读；migration 必须幂等。

## 验收

- 新建一场自动对练后，卡片可见“对练 11-22 22:10 · 时长 8分12秒 · ¥0.06”，下一行可见“来访 豆包 Seed Character · 咨询 MiniMax M3”（实际 ID 以配置为准，悬浮提示显示完整 ID）。
- 历史场次卡片不因 `visitor_model` 为 NULL 报错，显示“引擎 MiniMax-M3”并可在提示里看到该模型是引擎指纹模型。
- 运行中场次时长按当前时间递增；结束后固定为 `finishedAt - startedAt`。
- 悬浮提示包含开始/结束时间、退出原因、成本、批次、种子、来访者/咨询师/引擎模型。
- `ap_practice_sessions` 三列在远程 MySQL 成功新增；新建场次 INSERT 成功。
- 定向测试、lint、typecheck、管理台 type-check、全量测试全绿；engine-core 零改动。
