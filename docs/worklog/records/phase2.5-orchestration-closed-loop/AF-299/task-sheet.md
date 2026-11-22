---
taskId: AF-299
contextId: phase2.5-orchestration-closed-loop
title: 渲染故障矩阵真实回放（四类故障）
type: verification
status: backlog
baselineRef: eb30f22f5f3ea99c4374903097a09c6898f89de5
dependsOn: []
priorTasks: [AF-295, AF-298]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3]
createdAt: "2026-11-22T18:50:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - docs/runbooks/render-telemetry-alerting.md
    - docs/worklog/completed/phase2.5/af299-render-fault-matrix-2026-11-22.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-299/
  modules: []
  interfaces: []
artifacts:
  - name: AF-299 交付记录
    path: docs/worklog/completed/phase2.5/af299-render-fault-matrix-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --caller router --turns 1 --fail-primary --fail-backup --fail-primary-mode <mode> --expect-exhausted --dump-render-metrics
    check: server-error / timeout / auth / network 四类真实回放
    threshold: exit=0 且 assertSmokeOutcome 通过
successCriteria:
  - 四类故障各有一条真实链路 smoke 记录，ok=true，cause/rounds/degraded/fallback 与预期一致。
  - 至少一条首包后停摆（midstream-stall）路径记录，证明流式收尾降级而不切备。
  - Runbook 新增故障矩阵表（命令、预期 cause、预期 rounds、证据文件）。
  - 不新增代码、不改指标/阈值；只补文档与证据。
---

# AF-299 · 渲染故障矩阵真实回放（四类故障）（verification / executor）

> 状态：📋 待执行（2026-11-22）
> 来源：AF-295 只真实验证了 rate-limit；AF-292 外审要求故障矩阵覆盖 auth/5xx/超时/停摆。

## 1. 范围

**在范围内：**

- 用现有 smoke 故障注入跑 `server-error`、`timeout`、`auth`、`network` 四类；两候选同时故障走 `--expect-exhausted`，不消耗真实额度。
- 跑一条 `midstream-stall` 主候选单故障，验证 `degraded=true` 且 `rounds{degrade}`。
- 把命令、预期 cause、实际指标写进 Runbook 故障矩阵表。
- 交付记录附每条证据文件与关键字段。

**不在范围内：**

- 不改 smoke 代码、不改适配器、不改指标与告警阈值。
- 不消耗真实备候选额度做 fallback 成功链路（AF-295 已有 rate-limit fallback 证据）。

## 2. 验收口径

- 每条 smoke `ok=true`；`rounds{exhausted}=1`，`degraded{exhausted}=1`。
- cause 与模式对应：`server-error→server`、`timeout→timeout`、`auth→auth`、`network→other`（以实际 classify 为准，记录偏差）。
- auth 模式必须看到 `auth_failure_total` 计数。
- `midstream-stall`：`rounds{degrade}=1`、`degraded{timeout}` 或 `degraded{idle}`，不得切备。
- 不新增任何仓库代码；`git diff --stat HEAD -- src bin test` 为空。

## 3. 红线

- 不写 `.env`、不打印 key；故障上游只监听 127.0.0.1 临时端口。
- 不消耗真实额度：四类故障都让两候选指向本机故障上游或无效 key。
- 状态面只经 CLI。
