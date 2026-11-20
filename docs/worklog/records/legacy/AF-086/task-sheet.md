---
taskId: AF-086
contextId: phase2.5-orchestration-closed-loop
title: Phase 2.5 出口条件②真实 exam 双批次取证
type: verification
status: backlog
baselineRef: 772f250f17a2fc7856f1bd094b07646f946d1123
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T06:40:00.000Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/ops/quality/af086-exam-double-run.ts
    - docs/worklog/pending/phase2.5-README.md
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
    - data/batch-reports/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af086-phase25-exit2-real-exam-double-run-2026-11-18.md
    kind: report
gates:
  - command: corepack pnpm lint
    check: lint 全绿
    threshold: 0 error 0 warning
  - command: corepack pnpm typecheck
    check: 类型检查全绿
    threshold: 0 error
  - command: corepack pnpm test
    check: 全量单测全绿（收尾只跑一次）
    threshold: 0 failed
  - command: node scripts/orchestration/cli.mjs validate
    check: 状态索引、任务单、回执与契约目录全部 PASS
    threshold: exit 0
successCriteria:
  - 用 bin/dev-up.ps1 的同一套本地 MySQL/Redis 连接起服务，不修改 .env 文件
  - 通过生产 HTTP POST /admin/api/auto-practice/batch 连续创建两个同参数 exam 批次，每批 2 角色 × 2 模式 × 1 repeat / 12 轮
  - 两批全部跑完；每个场次的逐字稿 JSON 均记录 scenarioType=exam
  - 所有场次 deliberation_mode=rule_only；gate_decisions 仅 rule_only_skip，审议 LLM 调用 0 次、成本 0
  - 两批 engineVersion / promptVersion / characterVersion 等指纹一致；规则层关键指标可对比且不出现 regressed
  - 用 WP-K 正式 CLI 生成两批快照与对比结论，并把真实数字写回 README §3.2 出口②
  - 不新跑非 exam 批次，不改 src/engine-core，不改 .env，不删除历史数据与队列任务
  - 全程记录批次 id、场次 id、debugSessionId、命令、退出码与真实数字，不写推测结论
---

# AF-086 · Phase 2.5 出口条件②真实 exam 双批次取证

## 背景

AF-085 已证明生产 HTTP 入口、队列、worker、runner 四段链路闭合，并用单测锁定“同一 exam 请求连续两次 payload 除 `batchId` 外一致”。但真实 `exam` 批次从未跑过，出口②仍缺“同一场考核两次跑结果一致”的运行证据。

本单在本地服务 + 远程 MySQL/Redis 上，通过生产 HTTP 连续创建两个同参数 `exam` 批次，跑完后分别核对：

1. 逐字稿 JSON 的 `scenarioType` 是否为 `exam`；
2. `ap_practice_sessions.deliberation_mode` 是否全为 `rule_only`；
3. `gate_decisions` 是否只有 `rule_only_skip`、审议 LLM 调用是否为 0；
4. 两批的引擎 / prompt / 角色版本指纹是否一致；
5. WP-K 正式 CLI 的两批指标对比是否出现 `regressed`。

## 口径

- **不追求逐字稿逐字相同**：WP-B 已明确 LLM 概率性不可逐字复现，考核公平的判据是“规则层确定性 + exam 恒 rule_only + 版本可追溯”，而不是文本逐字相等。
- **真实批次双跑**：两个批次都走生产 HTTP 入口与真实 BullMQ worker，不使用直投队列脚本、不使用 mock runner。
- **可对比口径**：两批同角色、同模式、同 `maxTurns`、同 `scenarioType`，只允许 `batchId` / 场次 id / 时间不同。
- **失败即如实记录**：若两批指标出现 `regressed` 或规则层指纹不一致，出口②不得判 ✅，只写真实结论并保留缺口。

## 边界

- 不改 `src/engine-core`、不改业务 `src/`（只新增 `scripts/ops/quality/` 取证脚本）。
- 不改 `.env` 文件；basic auth 凭据通过启动进程的环境变量注入。
- 不删除、不清理既有数据库行与 BullMQ 任务；新批次使用新的 `batchId`。
- 不新跑非 `exam` 批次；不启用 `ENGINE_DELIBERATION_ENABLED`。
- 失败重跑必须使用新批次 id，不复用已消费的 jobId。
