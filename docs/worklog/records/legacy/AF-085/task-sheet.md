---
taskId: AF-085
contextId: phase2.5-orchestration-closed-loop
title: Phase 2.5 出口条件②生产入口复核与双跑确定性取证
type: verification
status: backlog
baselineRef: 86b9f0816f406d5e9d783dd5ff30bd44d542957a
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T06:20:00.000Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - test/auto-practice/batch-scenario-type.spec.ts
    - docs/worklog/pending/phase2.5-README.md
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af085-phase25-exit2-verification-2026-11-18.md
    kind: report
gates:
  - command: corepack pnpm exec vitest run test/auto-practice/batch-scenario-type.spec.ts test/engine-adapters/g123-deliberation-scenario-fingerprint.spec.ts test/engine-adapters/model-event-classifier.spec.ts
    check: 出口②入口链路与 exam 恒 rule_only 定向用例全绿
    threshold: 0 failed
  - command: corepack pnpm lint
    check: lint 全绿
    threshold: 0 error 0 warning
  - command: corepack pnpm test
    check: 全量单测全绿（收尾只跑一次）
    threshold: 0 failed
  - command: node scripts/orchestration/cli.mjs validate
    check: 状态索引、任务单、回执与契约目录全部 PASS
    threshold: exit 0
successCriteria:
  - 复核 AF-068 的 batch scenarioType 四段链路（HTTP 入口 → 队列 → worker → runner），确认生产入口已通
  - 新增同一 exam 批次请求连续两次的入口确定性用例：两次 payload 除 batchId 外逐字段一致，均带 scenarioType=exam
  - 复核 exam 恒 rule_only 的既有定向用例，确认入口与引擎侧红线同时成立
  - README §3.2 出口②状态按真实证据纠正，不再保留“生产 HTTP 无法创建 exam 批次”的旧口径
  - 不新跑 LLM 批次、不改 src/engine-core、不改 .env / 数据库 / Redis
  - 全量测试只跑一次且记录真实数字；不触碰并行产物
---

# AF-085 · Phase 2.5 出口条件②生产入口复核与双跑确定性取证

## 背景

Phase 2.5 README §3.2 仍写“`BatchBody` 仍只有 `characterSlugs/counselorModeIds/maxTurns/repeats`，`enqueueBatch()` 未把 `scenarioType` 传给队列，生产 HTTP 仍无法创建 exam 批次”。但 AF-068 已在 `integrate` 落地 `BatchBody.scenarioType`、`parseBatchScenarioType()`、入队校验与 `practice-queue.service.ts` 透传，并带 9 个入口/队列用例。

本单把这条链路作为出口条件②的正式证据重新锁定，并补一条“同一 exam 请求连续两次”的入口确定性用例，避免“入口能建 exam，但两次请求 payload 漂移”未被锁住。

## 范围

- 只改 `test/auto-practice/batch-scenario-type.spec.ts`、Phase 2.5 README 与本单交付记录。
- 不改业务 `src/`，不改 `src/engine-core`，不改 `.env`、数据库、Redis。
- 不新跑 LLM 批次；真实 exam 双跑批次不在本单范围，仍需另立取证单。

## 判定口径

- 本单能把出口②从“生产入口缺失”推进到“生产入口已通 + 入口层双跑确定性已测 + 引擎侧 exam 恒 rule_only 已有定向用例”；**不等于**已完成真实批次双跑。
- README 必须保留这一区分，不能把单测层证据写成真实批次结论。
