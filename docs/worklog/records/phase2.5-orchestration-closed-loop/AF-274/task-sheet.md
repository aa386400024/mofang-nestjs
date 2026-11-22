---
taskId: AF-274
contextId: phase2.5-orchestration-closed-loop
title: 流式首包后块间停摆超时治理
type: implementation
status: backlog
baselineRef: e121554cc8ae47c8767486c93bfd9b74ab6d6eeb
dependsOn: [AF-270, AF-273]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T12:22:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/rendering/llm-render.adapter.ts
    - bin/visitor-render-smoke.ts
    - test/engine-adapters/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af274-stream-midstream-idle-timeout-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/af274-stream-idle-timeout.spec.ts test/engine-adapters/af270-stream-timeout.spec.ts
    check: 块间停摆治理与首包超时回归
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: 流式状态机类型闭合
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --caller router --turns 1 --fail-primary --fail-primary-mode midstream-stall --expect-degraded --timeout-ms 1000 --expect-degraded-within-ms 5000
    check: 真实路由首包后停摆 1s 内收尾降级且至少产生 1 个可见增量
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --caller router --turns 3 --timeout-ms 30000
    check: 正常长流不被块间空闲超时误杀
    threshold: exit=0
---
# AF-274 · 流式首包后块间停摆超时治理

## 背景

AF-270 已把「上游接受连接但不回首包」限制到 `config.timeoutMs`，真实 timeout smoke 从 307s 降到 8s。但首包到达后适配器就清掉定时器，`openStream` 返回的迭代器进入 `for await` 后没有任何兜底：上游吐一句后彻底停摆时，SDK 仍会挂到传输层超时（约 300s）。AF-269 的 timeout 故障只覆盖首包前，AF-273 的故障回退也全在首包前；「已经出声后卡死」仍是生产可用性缺口。

## 目标

1. `llm-render.adapter.ts` 在首包之后对每次 `iterator.next()` 施加块间空闲超时（复用 `config.timeoutMs`），到点先 abort 上游，再收尾降级。
2. 已出声不能切备：块间停摆返回 `degrade`，不进入下一候选；只有首包前超时才允许 `retry` 切备。
3. 块间停摆记候选失败（`markFailure`），外部取消不记候选失败。
4. 首包后保留外部取消监听到流结束，修复「锁定后 barge-in 无法中止上游」。
5. 空 delta 的用量 / 心跳块也重置空闲计时，正常长流总时长超过 `timeoutMs` 不被误杀。
6. `visitor-render-smoke.ts` 新增 `--fail-primary-mode midstream-stall`（本机 SSE 先发一条然后停写）与 `--expect-degraded-within-ms`，并硬断言至少产生 1 个可见增量，避免把首包超时误当块间停摆。

## 非目标

- 不做整轮总时长上限；只限制「相邻两块之间的停摆」。
- 不改首包超时阈值与候选切换策略。
- 不改 MiniMax / 豆包价格、模型映射、候选链补备。
- 不改 401 策略、不做线上双跑。
- 不引入新的 provider 或新的流式协议。

## 验收

- 定向 7 例全绿（AF-274 4 例 + AF-270 3 例）。
- 真实 router smoke：`failPrimaryMode=midstream-stall`、`deltas>=1`、`ttftMs` 为毫秒级、`providerHint=degraded`、`degraded=true`、`wallElapsedMs` 约 1s（上限 5s），不再等 SDK 约 300s。
- 正常 3 轮豆包 smoke：3/3 `doubao`、`fallbackUsed=false`、`degraded=false`、`finishReason=stop`。
- tsc 0 error；lint 0 error；`git diff --stat HEAD -- src/engine-core` 为空。
