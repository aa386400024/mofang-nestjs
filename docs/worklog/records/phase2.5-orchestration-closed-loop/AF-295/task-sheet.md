---
taskId: AF-295
contextId: phase2.5-orchestration-closed-loop
title: smoke 双候选故障注入与 exhausted 真实取证（AF-295 重编号）
type: fix
status: backlog
baselineRef: 8fedf002b26c50f277f426c8ba917be5b52e4f0f
dependsOn: []
priorTasks: [AF-292, AF-294]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3]
createdAt: "2026-11-22T17:55:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - bin/visitor-render-smoke.ts
    - docs/runbooks/render-telemetry-alerting.md
    - docs/worklog/completed/phase2.5/af295-smoke-fail-backup-2026-11-22.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-295/
  modules: []
  interfaces: []
artifacts:
  - name: AF-295 交付记录
    path: docs/worklog/completed/phase2.5/af295-smoke-fail-backup-2026-11-22.md
    kind: report
gates:
  - command: pnpm typecheck
    check: TypeScript 全量类型检查
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --caller router --fail-primary --fail-backup --fail-primary-mode rate-limit --expect-exhausted --turns 1 --dump-render-metrics
    check: 真实双候选 429 的 exhausted 轮次指标
    threshold: ok=true 且 rounds_total{outcome=exhausted} 恰为 1
successCriteria:
  - smoke 支持 --fail-backup，与 --fail-primary 组合时把两个候选同时指向本机故障上游。
  - smoke 支持 --expect-exhausted，校验 providerHint=degraded、degraded=true、fallbackUsed=true，并取得 rounds_total{outcome=exhausted}。
  - 双候选 429 真实 smoke 取得 rounds_total{outcome=exhausted}=1、两候选 failure_total{cause=rate-limit}=1、degraded_total{cause=exhausted}=1。
  - 四轮双候选 429 取得 rounds_total{outcome=exhausted}=4，证明试完败与全员冷却两条路径都进入终局。
  - 既有 --fail-primary 单候选回退 smoke 行为不变，失败注入参数互斥关系继续 fail fast。
  - 不改 engine-core，不碰未跟踪半成品。
---

# AF-295 · smoke 双候选故障注入与 exhausted 真实取证（fix / executor）

> 状态：📋 待执行（2026-11-22）
> 来源：AF-292 交付记录遗留项 `visitor-render-smoke-no-backup-fault`。
> 重编号说明：本单原拟号 AF-294，登记时与并行任务 AF-294（V5 来访者约束对齐）撞号，对方先合入 integrate，本单改用 AF-295；文件与提交全部按 AF-295 重写。AF-293 同样被远端历史分支占用。

## 1. 范围

**在范围内：**

- `bin/visitor-render-smoke.ts` 增加 `--fail-backup` 与 `--expect-exhausted`；与现有故障开关做 fail fast 互斥校验。
- 双候选同时指向同一个本机故障上游，真实触发 `render()` 的候选耗尽路径。
- 用 `--dump-render-metrics` 取得 `visitor_render_rounds_total{outcome="exhausted"}` 与两候选 failure/降级指标。
- Runbook 盲区条目更新：exhausted 已有真实 smoke 取证方式，`fallback_total` 是切换尝试。
- 全量 lint/test 记录真实基线。

**不在范围内：**

- 不改 `src/engine-core/**`、不改渲染适配器生产逻辑、不改告警阈值。
- 不做并发+故障组合 smoke；不改 `--orchestrated` 的故障限制。
- 不碰 AF-280/AF-281 已并入的 V5 实现、`admin-dashboard/`、Flutter。

## 2. 验收口径

- `--fail-backup` 必须与 `--fail-primary` 同用，且仅限 `--caller router` + doubao/minimax。
- `--expect-exhausted` 与 `--expect-fallback` / `--expect-degraded` 三者互斥。
- exhausted smoke 的 turn 结果 providerHint=`degraded`、degraded=true；输出文本允许是系统兜底句，不得为空。
- 指标：`rounds_total{outcome="exhausted"}=1`；`failure_total{候主,cause="rate-limit"}=1`；`failure_total{候备,cause="rate-limit"}=1`；`degraded_total{cause="exhausted"}=1`。
- 实际 `fallback_total=1`：它是主备切换尝试数，不表示回退成功；判据以 rounds 与 degraded 为准。
- 单候选 `--fail-primary --expect-fallback` 既有行为不变，仍成功回退。
- `pnpm typecheck` exit 0；`git diff --stat HEAD -- src/engine-core` 为空。

## 3. 红线

- 故障上游只监听 127.0.0.1 临时端口，不写 `.env`、不打印密钥、不消耗真实额度。
- 指标标签只用封闭枚举，不带 prompt、台词、会话内容。
- 状态面只经 CLI；任务单正文不改写历史。
