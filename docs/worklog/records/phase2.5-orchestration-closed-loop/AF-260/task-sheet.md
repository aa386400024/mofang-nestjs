---
taskId: AF-260
contextId: phase2.5-orchestration-closed-loop
title: 引擎渲染豆包多轮连续 smoke
type: implementation
status: backlog
baselineRef: 766aca7fab4aef95b967d196db35f07aa24b958a
dependsOn: [AF-259]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T09:00:00+08:00"
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
    path: docs/worklog/completed/phase2.5/af260-render-multi-turn-smoke-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --caller router --provider doubao --turns 6 --max-tokens 160 --timeout-ms 45000
    check: 生产 RouterChatCaller 路径连续 6 轮真实豆包出话
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: CI 全量 typecheck 0 error
    threshold: exit=0
---
# AF-260 · 引擎渲染豆包多轮连续 smoke

## 背景

AF-259 只验证了生产 `RouterChatCaller` 单轮出话。真实对练是多轮：历史轮次会进入 `RenderSpec.recentTurns`，prompt 随轮次增长，任何一轮空输出 / 降级 / 切备候选都会让对练中断。需要在同一进程、同一条生产路由链上连续跑 6 轮，确认每轮都命中豆包主候选且历史能正常传递。

## 目标

1. `bin/visitor-render-smoke.ts` 新增 `--turns N`（默认 1），连续执行 N 轮。
2. 每轮把上一轮的来访回复追加进 `recentTurns`，形成 counselor/visitor 交替历史。
3. 每轮校验：非空、`providerHint=doubao`、`degraded=false`、`fallbackUsed=false`。
4. 输出逐轮 `chars/ttftMs/usage` 与全场合计；任一轮失败即非 0 退出。

## 非目标

- 不改 `src/engine-core`。
- 不改生产 `.env`。
- 不做并发、429/5xx、长对话摘要与成本分 provider 分账。
- 不启动 Nest、不写库。

## 验收

- 6 轮真实 smoke 全轮命中 `doubao-seed-character-260628`，无空输出、无降级、无回退。
- lint 0 error；CI 同口径 tsc 0 error。
- `git diff HEAD -- src/engine-core` 为空。
