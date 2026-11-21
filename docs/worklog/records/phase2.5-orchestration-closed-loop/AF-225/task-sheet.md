---
taskId: AF-225
contextId: phase2.5-orchestration-closed-loop
title: 来访者真人度 R6-B：评分稳定性与截断恢复
type: implementation
status: backlog
baselineRef: 4017839ce8b5a5faccf812e75b9861f49de180ed
dependsOn: [AF-216]
priorTasks: [AF-207, AF-208, AF-209, AF-213, AF-214, AF-216]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-21T09:50:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/auto-practice/metrics/
    - bin/
    - test/auto-practice/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af225-realism-r6b-scoring-stability-2026-11-21.md
    kind: report
  - name: 失败 packet 恢复探针报告
    path: data/phase25-exit/af225-realism-stability/report.json
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/af225-realism-stability.spec.ts test/auto-practice/af214-realism-rating.spec.ts test/auto-practice/af214-realism-blind-pack.spec.ts
    check: R6-B 稳定性测试 + R5 回归全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 后端类型检查 0 error
    threshold: exit=0
  - command: pnpm lint
    check: lint 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量测试 0 failed
    threshold: exit=0
  - command: node --env-file=.env --import tsx bin/visitor-realism-stability-probe.ts --packet-ids 005c9606d209a55d,02b82823ffa9479e,04172a05c74f4b76,069466ea9f8e0261 --max-output-tokens 5000
    check: 对 R5 复算的 4 个失败 packet 做真实 LLM 恢复探针
    threshold: exit=0 且 4/4 packet 完成五维评分，不再出现 dimension_missing
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty
successCriteria:
  - 找出 R5 复算 4 个失败 packet 的真实根因，区分“协议缺失”与“思考 token 吃满预算”，不能用 dimension_missing 一概而论。
  - 评分员首次输出被截断或只有思考块时，进入一个明确的 compact 重试：仍按行协议、五维必须齐全、quote 限短、notes 可省，不得改用 JSON。
  - compact 重试不得放宽证据校验：quote 仍必须能在指定轮次来访者台词中定位；不得为了凑齐五维编造证据。
  - 解析层把“没有任何维度行”与“缺少某一维”区分开，失败原因可诊断；不返回台词原文。
  - 对 R5 复算的 4 个失败 packet 真实重跑，4/4 完成五维评分；若仍有失败，保留失败表并说明原因，不静默换包。
  - 既有 R5 评分协议、盲评包与仲裁行为回归通过；engine-core 零改动。
  - 不修改 provider 选择、模型、.env、scripts/orchestration/；不触碰 admin-dashboard 与 Flutter。
---

# AF-225 · 来访者真人度 R6-B：评分稳定性与截断恢复

## 1. 背景

R5 同批复算有 4/12 packet 失败，失败原因都是 `dimension_missing:naturalness`，但日志显示真实形态不是“模型漏了自然度”，而是：

- `finish=length`，`completionTokens=3000` 全部用尽；
- 输出 10K–13K 字符，全部包在 `<think>` 标签里；
- 去掉思考块后没有任何维度行，协议根本没开始输出。

当前重试提示词写的是“只输出一个 JSON 对象”，与主协议的行协议不一致，第二次仍然被思考吃满预算。所以问题属于评分稳定性，不是 R6 prompt 改动导致。

## 2. 本单目标

只做评分链路的提示词与解析加固，不改 provider 选择、模型与 `.env`：

1. 首次评分仍用现有行协议，保持 R5 行为不变。
2. 当首次输出被截断、只剩思考块、或缺少维度行时，进入 compact 行协议重试：
   - 明确“不要思考、第一行就是 naturalness=”；
   - 五维必须齐全，quote 限短，notes 可省；
   - 证据校验规则不放宽。
3. 解析层区分 `no_protocol_lines` 与 `dimension_missing:<dim>`，失败原因可定位。
4. 新增失败 packet 恢复探针，按 packetId 精确重跑 R5 的 4 个失败包，报告只落分数、完成状态与失败原因，不落台词原文。

## 3. 不做

- 不改 R6-A 的状态化节奏与 prompt 条件分布。
- 不换评分模型、不换 provider、不改 `.env`。
- 不做真人督导师双标，`clinicalAcceptanceEligible` 保持 false。
- 不做 R6-C 线上场景补样本。
- 不改 `scripts/orchestration/`。

## 4. 闸门

见 frontmatter `gates`。定向测试至少覆盖：

- compact 重试提示词仍是行协议且五维齐全；
- 只有思考块的输出被识别为 `no_protocol_lines`；
- 缺某一维仍返回 `dimension_missing:<dim>`；
- 证据校验在 compact 路径不放宽；
- R5 评分与盲评包回归。

## 5. 交付

- 交付记录：`docs/worklog/completed/phase2.5/af225-realism-r6b-scoring-stability-2026-11-21.md`
- 恢复探针报告：`data/phase25-exit/af225-realism-stability/report.json`（gitignored，交付记录引用）
- 机读回执：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-225/receipt-RC-AF-225-1.json`
