---
taskId: AF-270
contextId: phase2.5-orchestration-closed-loop
title: 流式渲染首包超时受 ENGINE_RENDER_TIMEOUT_MS 约束，修复上游挂起时约 300s 才切备
type: fix
status: backlog
baselineRef: ffd465e908eda08c6f4e4d158c95635f2eb32d5c
dependsOn: [AF-269]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T11:45:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/rendering/
    - test/engine-adapters/
    - bin/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af270-stream-first-delta-timeout-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: 流式超时控制类型闭合
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec vitest run test/engine-adapters/af270-stream-timeout.spec.ts
    check: 首包挂起在配置超时内中止并切备
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --fail-primary --fail-primary-mode timeout --expect-fallback --timeout-ms 5000 --expect-fallback-within-ms 15000
    check: 真实超时故障在 15 秒内切备成功
    threshold: exit=0
---
# AF-270 · 流式渲染首包超时受 `ENGINE_RENDER_TIMEOUT_MS` 约束

## 背景

AF-269 真实验证了三类上游故障的候选回退，但超时模式暴露出生产缺口：

- 探针 `callOnce` 有 `AbortController` + `config.timeoutMs`，2 秒就失败；
- 渲染 `openStream` 只把 `handlers.signal` 透传，没有用 `config.timeoutMs` 建超时；
- 上游「接受连接但不返回首包」时，流式 SDK 自身 headersTimeout 约 300 秒才报错，主候选实际挂 307 秒才切 MiniMax。

这会直接拖死语音对练首包。需要在渲染适配器层补首包超时，且不能改变「已出声不重试」的既有语义。

## 目标

1. `LlmRenderAdapter.openStream` 用 `config.timeoutMs` 建 `AbortController`，超时主动 abort 上游流，避免幽灵连接继续占用。
2. 同时尊重调用方 `handlers.signal`：外部取消与内部超时任一触发都中止流。
3. 首 delta 到达后立即清理定时器，不影响正常长回复；已出声后的中途错误仍沿用「不切备、收尾降级」。
4. 超时失败按可重试故障归类，切下一个候选；日志写明「流式首包超时」。
5. `bin/visitor-render-smoke.ts` 增加 `--expect-fallback-within-ms`，把切备延迟变成可机读 gate。
6. 真实 timeout smoke 在 `--timeout-ms 5000` 下于 15 秒内完成切备。

## 非目标

- 不改 `ENGINE_RENDER_TIMEOUT_MS` 默认值，不改 `render-config.factory` 装配口径。
- 不引入全流总时长限制；本任务只治「首包前挂死」，已出声后的长时间生成不截断。
- 不改 MiniMax / 豆包 provider 自身 SDK 配置。
- 不改 401 快速降级策略。

## 验收

- 新增单测覆盖：主候选首包挂起 → 配置超时内 abort → markFailure → 切备成功；外部 signal 取消同样中止；正常首包到达后定时器清理、长流不被误杀。
- 真实 timeout smoke 在 5 秒配置下总耗时 < 15 秒，`fallbackUsed=true`、`degraded=false`、`finishReason=stop`。
- tsc / lint 0 error；engine-core 零改动。
