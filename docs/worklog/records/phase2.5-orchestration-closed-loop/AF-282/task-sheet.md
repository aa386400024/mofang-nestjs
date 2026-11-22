---
taskId: AF-282
contextId: phase2.5-orchestration-closed-loop
title: 渲染遥测语义修正（barge-in 不计降级 + 候选失败原因指标 + 安全拦截 cause 统一）
type: implementation
status: backlog
baselineRef: 5bcd031ee3800cf36182b53a9b2a00cc6c404383
dependsOn: [AF-278]
priorTasks: [AF-278, AF-279]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T14:40:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/infra/metrics/metrics.service.ts
    - src/engine-adapters/rendering/render-telemetry.port.ts
    - src/engine-adapters/rendering/render-metrics.telemetry.ts
    - src/engine-adapters/rendering/llm-render.adapter.ts
    - test/engine-adapters/
    - test/shared/infra/metrics/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af282-render-telemetry-correctness-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/af282-render-telemetry-correctness.spec.ts test/engine-adapters/af278-render-telemetry.spec.ts test/shared/infra/metrics/render-telemetry-metrics.spec.ts
    check: 新增用例与 AF-278 既有用例全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型闭合
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量回归
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: 输出为空
---
# AF-282 · 渲染遥测语义修正

## 背景

AF-278 把渲染链路六类指标接进 Prometheus，MiniMax Code 只读评审（AF-279）结论为 conditional-pass。评审给出两条 P0：

1. **barge-in 被计成渲染降级**：用户正常打断走到外部取消分支，返回不带 cause 的 `degrade`，顶层按 `other` 记 `visitor_render_degraded_total` 与 `attempts{outcome=degrade}`。语音训练里打断是高频正常交互，降级率会被灌水，告警结论反号。
2. **末次/单候选失败原因消失**：`attempts` 标签没有 cause，候选耗尽统一 `cause='exhausted'`；单候选部署的 429 / 5xx / 聚合超时在六类指标里完全消失。

另有 P1：输出侧安全拦截三处 degrade 未带 `guard` cause；锁定后鉴权失败不记 auth 指标；首包超时判定优先于外部取消，真实取消可能被误记成超时。

## 目标

1. 新增 `visitor_render_failure_total{candidate,model,cause}`：每次**候选级**失败记一次，含末次候选；`degraded_total{cause}` 保留轮次语义，`exhausted` 表示候选耗尽，不再冒充末次失败原因。
2. 新增 `visitor_render_cancelled_total{candidate}`：外部取消（barge-in / 暂停）单独计数；`degraded_total` 与 `attempts{outcome=degrade}` 不再被正常打断污染。
3. 输出侧 guard block 的 degrade 统一带 `cause='guard'`；锁定后鉴权失败带 `cause='auth'` 并记 auth 指标。
4. 首包窗口判定改为外部取消优先于超时，避免取消被误归因成 `first-delta`。
5. 遥测继续纯旁路：任何指标实现抛错不影响渲染结果；标签仍只含候选/模型/封闭枚举。

## 非目标

- 不改候选选择、冷却、重试、fallback 预算、prompt、模型配置。
- 不改 `RenderResult` / `StreamRenderOutcome` 的对外语义（barge-in 仍返回原有降级结果，只修指标口径）。
- 不做 first-delta 与 TTFT 同名不同义的拆分（留待后续单）。
- 不改 `src/engine-core/**`。

## 方法

- 端口新增 `onFailure(candidateId, model, cause)` 与 `onCancelled(candidateId, model)`，均为可选方法。
- `runCandidateLoop` 在每次非 success 终局统一上报 `onFailure`；cause=cancelled 时改报 `onCancelled`，且不记 `attempts{outcome=degrade}`。
- `degradeOutcome` 对 cause=cancelled 跳过 `onDegraded`。
- `streamAttempt` 首包前外部取消带 `cause='cancelled'`；锁定后中断先看 `handlers.signal?.aborted`，是取消则 `cancelled`，否则按 auth / 错误分类。
- `handleText` / `regenerate` / 真人度重试的 guard block 与上游失败补 cause。
- 指标实现新增两个 Counter 与两个方法，`metrics.enabled=false` 继续 no-op。

## 验收

- 新增 spec 覆盖：外部取消不记 degraded/attempts degrade 且记 cancelled；单候选 429 记 failure{rate-limit} + degraded{exhausted}；多候末次 500 保留 server；guard block 记 guard；锁定后 401 记 auth；遥测抛错不影响渲染。
- 定向三 spec 全绿；`pnpm typecheck` exit 0；`pnpm lint` 0 error / 0 warning；`pnpm test` 全绿；engine-core diff 为空。
- 交付记录写清改动文件、关键决策、闸门真实数字、与任务单偏差。
- 回执六组字段齐全，`reviewVerdict=passed`，`scopeCheck=in-scope`。
