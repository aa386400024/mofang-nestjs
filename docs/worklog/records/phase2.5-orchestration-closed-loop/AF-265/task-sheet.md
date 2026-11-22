---
taskId: AF-265
contextId: phase2.5-orchestration-closed-loop
title: 来访者渲染并发 smoke
type: implementation
status: backlog
baselineRef: 6bada58a2a3a619bf91c39f097fc696c477e6c9e
dependsOn: [AF-264]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T09:50:00+08:00"
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
    path: docs/worklog/completed/phase2.5/af265-visitor-concurrency-smoke-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --caller router --provider doubao --concurrency 8 --max-tokens 120 --timeout-ms 60000
    check: 8 路并发全部命中豆包、非空、无降级无回退
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --caller router --provider doubao --turns 6
    check: 串行 6 轮仍全轮命中豆包
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: CI 全量 typecheck 0 error
    threshold: exit=0
---
# AF-265 · 来访者渲染并发 smoke

## 背景

AF-259/260/263/264 已覆盖单轮、串行多轮、切流与故障回退，但都是单请求。生产灰度会同时有多个咨询师对练，渲染适配器与主备运行时是进程内共享实例，需要证明并发下不串话、不互相踩冷却、不出现空输出。

## 目标

1. `bin/visitor-render-smoke.ts` 新增 `--concurrency N`：N 个独立单轮会话并发调用同一渲染端口。
2. 每路使用独立 history 与不同咨询师开场，逐路校验非空、豆包、无降级、无回退。
3. 输出 `concurrency`、`wallElapsedMs`、逐路 `ttftMs/elapsedMs/chars` 与总 usage。
4. 串行路径保持原行为；`--concurrency` 与 `--turns` 互斥（并发模式固定单轮）。

## 非目标

- 不做长时间压测与阶梯升压。
- 不验证 429/5xx 下的并发退避（另列 backlog）。
- 不改渲染适配器与主备运行时实现。

## 验收

- 8 路并发 exit 0，8/8 `providerHint=doubao`、`fallbackUsed=false`、`degraded=false`、输出非空。
- 串行 6 轮 exit 0，仍全轮豆包。
- lint 0 error；CI 同口径 tsc 0 error；`git diff HEAD -- src/engine-core` 为空。
