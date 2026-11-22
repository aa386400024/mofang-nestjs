---
taskId: AF-328
contextId: phase2.5-orchestration-closed-loop
title: 文字真人度 humanization-v1 判据与离线审计 CLI
type: implementation
status: backlog
baselineRef: 02c8a9ea8aad4a36420cec95930157dbcd5bca44
dependsOn: []
priorTasks: [AF-327]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-23T02:47:00+08:00
deadline: 2026-11-23T19:00:00+08:00
agentRole: executor
scope:
  files:
    - src/auto-practice/metrics/
    - test/auto-practice/metrics/
    - bin/
    - docs/worklog/pending/
    - docs/worklog/completed/
    - docs/worklog/records/
  modules:
    - auto-practice-metrics
  interfaces:
    - humanization-acceptance-v1
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af328-humanization-acceptance-v1-2026-11-23.md
    kind: report
  - name: 真实语料审计报告
    path: docs/worklog/completed/phase2.5/af328-humanization-audit-2026-11-23.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/metrics/humanization-acceptance.spec.ts
    check: 定向单测全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量测试全绿
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: 输出为空
    threshold: exit=0
successCriteria:
  - 新增纯模块 humanization-v1 判据，版本常量、判据表、逐条评估结果，零 IO / 零框架 / 零随机。
  - 判据只在 realismMode=active 时参与判定；off / audit 一律返回 not_applicable 并说明原因，禁止用真人度门槛误判历史 off 批次。
  - 新增离线审计 CLI，读取 data/debug-sessions 的 visitor 台词，按场次与总体输出六类不流利数字、判据结果和模式；支持 --mode、--ids、--json、--fail-on-violation。
  - 在真实 7 场语料上跑出可复跑的 audit 基线报告，明确标注不是临床结论、不作为 active 验收通过。
  - 单测覆盖版本/判据边界/模式门/空样本/CLI 数字契约，至少 10 例。
  - 定向测试、typecheck、lint、全量测试、engine-core 零 diff 全部通过，并记录真实数字。
  - 不修改 RENDER_REALISM_MODE 默认值，不切换生产渲染链路，不写任何台词原文到报告。
---

# AF-328 · 文字真人度 humanization-v1 判据与离线审计 CLI

本单由 AF-327 经 `task rescope` 重签发。AF-327 的 scope 含 `package.json` 与 `docs/worklog/`，越出 executor Agent Card 的 `resources`（只授权 `src/` / `bin/` / `test/` 与 `docs/worklog/pending|completed|records`），`run-once` 报 `scope-domain-conflict`。重签发只收窄 scope，不放大任务目标。

## 背景

文字真人度在 Phase3 蓝图里一直缺一个可判读的口径：P0 已有六类不流利分析器与聚合函数，P1 已有真实语料基线，AF-226/AF-227 也做过 24 packet 评分，但仓库里没有 `humanization-v1` 判据，也没有一个不误判历史 off 批次的离线审计入口。本单只补 AI 层度量与判据，不碰真人督导，不做临床宣称。

## 范围

- 新增纯判据模块：六类不流利指标 → 真人度判据，带模式门（off / audit 不判定）。
- 新增离线审计 CLI：扫描 `data/debug-sessions`，输出每场与总体的数字和判据结果；报告只含数字，不含台词原文。
- 增加单测；不新增 package.json 脚本，CLI 以 `pnpm exec tsx bin/...` 调用，遵守仓库 pnpm 工具链口径。
- 不改 `RENDER_REALISM_MODE` 默认值，不改渲染链路，不改 `BatchMetricsV1` 结构。

## 判据口径（工程种子）

- 轮次事件率 `eventTurnRate` 取区间：真人文本应当“不是完全干净，也不是处处结巴”。
- 每轮事件数 `eventsPerTurn` 设上限，防止注入过量。
- 自我修正每轮 `repairPerTurn` 设上限，防止把改口当常态。
- 空样本、少样本返回 `not_applicable`，不做低样本硬判定。

## 验收

以任务单 frontmatter 的 `successCriteria` 与 `gates` 为准；真实语料报告必须写清模式与适用范围，不把 audit 基线当 active 通过。
