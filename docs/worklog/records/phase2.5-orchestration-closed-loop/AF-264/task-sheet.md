---
taskId: AF-264
contextId: phase2.5-orchestration-closed-loop
title: 来访者主候选故障真实回退 smoke
type: implementation
status: backlog
baselineRef: 478a8afbc8f37f9a76e9cf91f31e1419156bbd57
dependsOn: [AF-263]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T09:30:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - bin/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af264-visitor-fallback-smoke-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --caller router --provider doubao --turns 1 --fail-primary --expect-fallback
    check: 主候选鉴权失败后真实切到 MiniMax 并产出非空回复
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --caller router --provider doubao --turns 6
    check: 正常路径 6 轮仍全轮命中豆包
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: CI 全量 typecheck 0 error
    threshold: exit=0
---
# AF-264 · 来访者主候选故障真实回退 smoke

## 背景

AF-259/260/263 只验证了豆包主候选成功路径。生产切流后真正危险的场景是**主候选鉴权失败或请求失败**：如果渲染适配器只重试不换候选，用户会看到兜底句；如果候选装配有误，可能整场对练降级。当前回退逻辑只有单测覆盖，没有真实上游证据。

## 目标

1. `bin/visitor-render-smoke.ts` 的 router 路径同时注册豆包与 MiniMax，使备候选可以被真实调用。
2. 新增 `--fail-primary`：只对本次进程注入无效豆包 key，让主候选真实收到 401；不打印密钥、不写 `.env`。
3. 新增 `--expect-fallback`：断言 `fallbackUsed=true`、`providerHint=minimax`、`degraded=false`、输出非空，并打印主候选失败摘要。
4. 正常路径 6 轮 smoke 保持全轮豆包，作为回退能力不影响主路径的证据。
5. 交付记录写清注入方式、失败摘要、回退耗时、MiniMax 输出与 usage。

## 非目标

- 不模拟 429/5xx/网络超时。
- 不做并发压测。
- 不改生产代码的回退策略，只补 smoke 能力与真实证据。
- 不填豆包官方单价。

## 验收

- 回退 smoke exit 0，`providerHint=minimax`、`fallbackUsed=true`、`degraded=false`、输出非空。
- 正常 6 轮仍 `providerHint=doubao`、`fallbackUsed=false`、`degraded=false`。
- 无效 key 只存在于 smoke 进程内存，不落 `.env`、不进日志。
- lint 0 error；CI 同口径 tsc 0 error；`git diff HEAD -- src/engine-core` 为空。
