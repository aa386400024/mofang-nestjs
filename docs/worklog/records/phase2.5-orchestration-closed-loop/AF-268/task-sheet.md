---
taskId: AF-268
contextId: phase2.5-orchestration-closed-loop
title: 来访者长上下文 40 轮真实路由 smoke
type: implementation
status: backlog
baselineRef: 0453068e35367bfcd7f75cbbe2a06cbf1ad84c96
dependsOn: [AF-267]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T10:40:00+08:00"
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
    path: docs/worklog/completed/phase2.5/af268-long-context-40-turn-smoke-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: 新增 orchestrated 模式的类型闭合
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --orchestrated --turns 40 --summary-after 20 --max-tokens 120 --timeout-ms 60000
    check: 40 轮真实豆包渲染不降级，prompt 在窗口处封顶，摘要注入生效
    threshold: exit=0
---
# AF-268 · 来访者长上下文 40 轮真实路由 smoke

## 背景

AF-263/264/265 已经验证单轮、故障回退和 8 路并发，但多轮只跑到 20 轮，且 smoke 直接调 `streamRender`、自己维护无界 history，绕过了生产门面的 `MAX_HISTORY_TURNS` 与 `fitContextToBudget` 窗口裁剪。真实对练越聊越长时，prompt 会不会无界增长、滚动摘要有没有真的进 prompt，目前没有证据。

## 目标

1. `bin/visitor-render-smoke.ts` 新增 `--orchestrated` 模式：用真实 `TurnRenderOrchestrator`（真实渲染端口 + 假内核会话）跑多轮，历史裁剪、规格组装、滚动摘要读取全部走生产门面。
2. 新增 `--summary-after N`：在门面里注入一个只读摘要桩，从第 N 轮起返回固定三段摘要，验证 `sessionSummary` 进入 system prompt。
3. 每轮记录 prompt 字符数、prompt 是否含摘要，输出机读序列。
4. 跑 40 轮真实豆包路由：`--turns 40 --summary-after 20 --max-tokens 120`，要求全轮不降级、不回退，prompt 在窗口封顶后不再线性增长，摘要从第 20 轮起出现。

## 非目标

- 不模拟完整 BDI 决策（假内核固定返回中性快照，只验证渲染门面链路）。
- 不改生产 `TurnRenderOrchestrator` / `MAX_HISTORY_TURNS` / `fitContextToBudget`。
- 不验证真实滚动摘要 LLM 生成（由 WP37/WP55 既有测试覆盖），只验证摘要读取→prompt 接线。

## 验收

- `--orchestrated --turns 40` 全轮 `providerHint=doubao`、`degraded=false`、`fallbackUsed=false`。
- prompt 字符数在窗口封顶后稳定，不再随轮次线性增长。
- 第 20 轮起 `promptHasSummary=true`；之前为 false。
- tsc/lint 0 error；engine-core 零改动。
