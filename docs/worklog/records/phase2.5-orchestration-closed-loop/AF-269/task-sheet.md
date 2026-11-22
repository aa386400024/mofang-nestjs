---
taskId: AF-269
contextId: phase2.5-orchestration-closed-loop
title: 来访者渲染限流/5xx/超时三类故障的真实候选回退 smoke
type: implementation
status: backlog
baselineRef: 8efe879040b63108bd65105c1037a15d468fd319
dependsOn: [AF-268]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T11:00:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - bin/
    - test/engine-adapters/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af269-fault-fallback-smoke-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: 新增故障模式的类型闭合
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --fail-primary --fail-primary-mode rate-limit --expect-fallback
    check: 豆包 429 限流真实切 MiniMax，fallbackUsed=true 且 degraded=false
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --fail-primary --fail-primary-mode server-error --expect-fallback
    check: 豆包 5xx 真实切 MiniMax，fallbackUsed=true 且 degraded=false
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --fail-primary --fail-primary-mode timeout --expect-fallback
    check: 豆包超时真实切 MiniMax，fallbackUsed=true 且 degraded=false
    threshold: exit=0
---
# AF-269 · 来访者渲染限流 / 5xx / 超时三类故障的真实候选回退 smoke

## 背景

AF-264 已证明两类故障语义：

- **401 鉴权失败**：不可重试，直接 `degraded=true` 输出兜底句，不切 MiniMax（生产既有语义，已登记 `visitor-auth-failure-fallback-policy`）。
- **传输失败（连接不可达）**：可重试，真实切 MiniMax，`fallbackUsed=true`、`degraded=false`。

但生产最常见的三类上游故障仍未取证：**429 限流、5xx 服务端错误、请求超时**。渲染适配器的 `classifyFailure` 只对鉴权失败判不可重试，其余一律切备；这条语义需要真实上游返回码与真实超时来验证，而不是靠单测桩。

## 目标

1. `bin/visitor-render-smoke.ts` 的 `--fail-primary-mode` 扩展 `rate-limit | server-error | timeout` 三个取值。
2. 故障注入必须走**真实 HTTP 上游语义**：起一个本机临时 HTTP 服务，按模式返回 429 / 500 / 延迟不响应；把豆包候选 baseUrl 指向它，不改 `.env`、不打真实豆包 key。
3. 三种模式各跑一次真实渲染：要求主候选失败、备候选 MiniMax 成功出话；`providerHint=minimax`、`fallbackUsed=true`、`degraded=false`、`finishReason=stop`、reply 非兜底句。
4. 记录探针错误、耗时、TTFT、usage，输出机读报告，便于后续回归复跑。
5. 正常路径复跑 3 轮，确认故障开关关闭时仍走豆包、不回退、不降级。

## 非目标

- 不改生产 `LlmRenderAdapter` / `classifyFailure` / `RenderFailoverRuntime`。
- 不重试同一候选；候选循环仍是「一次失败即切下一个」的既有语义。
- 不验证 401 策略变更；401 仍按 AF-264 结论快速降级。
- 不测 429 的 `Retry-After` 退避：生产当前在同候选内不做退避，本任务只证明「切备可用」。

## 验收

- 三种模式均 exit 0，且报告满足：`fallbackUsed=true`、`degraded=false`、`providerHint=minimax`、`model=MiniMax-M3`、`chars>0`、`finishReason=stop`。
- 报告记录故障模式、探针错误、主候选耗时；429/500 的主候选耗时应显著小于超时模式。
- 正常 3 轮复跑全走豆包，`fallbackUsed=false`、`degraded=false`。
- tsc / lint 0 error；engine-core 零改动；不改真实 `.env`。
