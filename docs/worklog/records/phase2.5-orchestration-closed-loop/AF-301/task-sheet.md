---
taskId: AF-301
contextId: phase2.5-orchestration-closed-loop
title: 突发告警按故障生命周期分窗
type: fix
status: backlog
baselineRef: 2a00b9ddd4d60021715630c491c281ce3832a61d
dependsOn: []
priorTasks: [AF-292, AF-298, AF-300]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3]
createdAt: "2026-11-22T19:06:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - docker/prometheus/alerts.yml
    - test/config/af283-render-alerting.spec.ts
    - docs/runbooks/render-telemetry-alerting.md
    - docs/worklog/completed/phase2.5/af301-alert-lifecycle-window-2026-11-22.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-301/
  modules: [prometheus]
  interfaces: []
artifacts:
  - name: AF-301 交付记录
    path: docs/worklog/completed/phase2.5/af301-alert-lifecycle-window-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/config/af283-render-alerting.spec.ts
    check: 四条突发告警必须含近期 1m 持续条件，鉴权告警不误加
    threshold: exit=0 且 0 failed
successCriteria:
  - StreamTimeoutSpike、FailureCauseSpike、CooldownServedSpike、CandidateCooldownSpike 增加“最近 1m 仍有增量”的持续条件，故障停止后不再被 10m 窗口拖着继续 firing。
  - AuthFailure 保持“任一次 401 都告警”，不加快期条件，避免低流量时自动消警掩盖配置错误。
  - 静态测试逐条断言四条 Spike 含 1m 条件、Auth 不含；反向去掉一条 1m 条件测试必须失败。
  - Runbook §2/§7 写清生命周期分窗语义与低流量取舍；不改阈值、不改业务代码。
---

# AF-301 · 突发告警按故障生命周期分窗（fix / executor）

> 状态：📋 待执行（2026-11-22）
> 来源：AF-292-REVIEW C2 指出突发计数器 10m 窗口在故障结束后仍会持续 firing；AF-298 只补了滞后说明，没有从表达式上收口。

## 1. 范围

**在范围内：**

- 四条按次数判定的 Spike 告警加 `and sum(increase(<同指标>[1m])) ... > 0` 持续条件。
- 鉴权告警保持原样：任一次 401 都告警，低流量也不自动消警。
- 静态测试覆盖“四条必须有、Auth 必须没有”；反向验证一条缺失。
- Runbook 写清“10m 判强度、1m 判是否仍在发生”的判读纪律与低流量取舍。

**不在范围内：**

- 不改任何阈值与 `for` 时长。
- 不改比率类告警（降级率/回退率/恒等式），它们另有窗口语义。
- 不改业务代码、不改看板。

## 2. 验收口径

- 四条 Spike 的 expr 同时含 10m 强度条件与 1m 持续条件，标签匹配维度一致。
- AuthFailure 不含 `[1m]` 持续条件。
- 静态测试 10 例全绿；反向去掉 FailureCauseSpike 的 1m 条件，测试精确失败。
- typecheck/lint/全量测试全绿；engine-core 零改动。
