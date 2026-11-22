---
taskId: AF-297
contextId: phase2.5-orchestration-closed-loop
title: 渲染轮次结局恰好一次（异常逃逸兜底）
type: fix
status: backlog
baselineRef: 16f8707204dbf25fc733d30254c4237325696336
dependsOn: []
priorTasks: [AF-292, AF-296]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3]
createdAt: "2026-11-22T18:20:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/rendering/llm-render.adapter.ts
    - test/engine-adapters/af292-render-round-outcome.spec.ts
    - docs/worklog/completed/phase2.5/af297-render-round-exactly-once-2026-11-22.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-297/
  modules: []
  interfaces: []
artifacts:
  - name: AF-297 交付记录
    path: docs/worklog/completed/phase2.5/af297-render-round-exactly-once-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/af292-render-round-outcome.spec.ts
    check: 轮次结局恰好一次与异常兜底
    threshold: exit=0
  - command: pnpm typecheck
    check: TypeScript 全量类型检查
    threshold: exit=0
successCriteria:
  - render() / streamRender() 顶层有 try/catch 兜底，异常逃逸时返回兜底话术而不是 reject。
  - 异常兜底同样记 rounds{degrade}，且一次调用恰好一次，不因嵌套 render/streamViaAggregate 重复。
  - 成功/降级/取消/guard/exhausted 的既有上报次数不变。
  - buildMessages 抛错、streamViaAggregate 抛错两条入口各有一条测试证明只记一次。
  - 不改 engine-core、不改指标名、不碰告警阈值。
---

# AF-297 · 渲染轮次结局恰好一次（异常逃逸兜底）（fix / executor）

> 状态：📋 待执行（2026-11-22）
> 来源：AF-292 外审 A6。`render()` / `streamRender()` 没有顶层 try/finally，异常逃逸路径可能既不进 rounds 分子也不进分母，同时违反“永不 reject”。

## 1. 范围

**在范围内：**

- 在 `llm-render.adapter.ts` 引入每次调用独立的轮次上报 sink（`report` + `settled`）。
- `render()` / `streamRender()` 顶层 try/catch：异常时记一次 `rounds{degrade}` 并返回兜底话术。
- `streamViaAggregate` 与聚合回退共享同一个 sink，避免嵌套调用重复上报。
- 新增异常逃逸测试：`buildMessages` 抛错、无流式出口的 `streamViaAggregate` 抛错。
- 全量 lint/test 收尾取证。

**不在范围内：**

- 不改 `runCandidateLoop` 主备/冷却逻辑。
- 不改 metrics 名称、标签、告警阈值与看板。
- 不碰 engine-core、admin-dashboard、Flutter。

## 2. 验收口径

- `render()` 在 `buildMessages` 抛 Error 时 resolve 出兜底话术，`rounds` 恰为 `['degrade']`。
- `streamRender()` 同样 resolve，`rounds` 恰为 `['degrade']`。
- 调用出口无 stream、走 `streamViaAggregate` 时，异常仍只记一次，不得 `['degrade','degrade']`。
- 既有 AF-292 五条轮次结局测试全绿。
- `pnpm typecheck` exit 0；`git diff --stat HEAD -- src/engine-core` 为空。

## 3. 红线

- 异常日志只记错误类型/阶段，不记 prompt、对话原文、来访者心理内容。
- 不上抛异常到调用方；兜底话术沿用既有轮换池。
- 状态面只经 CLI；任务单正文不改写历史。
