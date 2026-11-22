---
taskId: AF-273
contextId: phase2.5-orchestration-closed-loop
title: 回滚态候选链保底守卫与故障回退 smoke
type: implementation
status: backlog
baselineRef: fa0c793184f0395d9eda76e775067223a9a0b215
dependsOn: [AF-271]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T12:10:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/wiring/render-config.factory.ts
    - bin/
    - test/engine-adapters/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af273-rollback-failover-guard-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/af273-rollback-failover-guard.spec.ts
    check: 回滚态保底候选单测通过
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: 候选守卫类型闭合
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-switch-check.ts --expect-primary doubao
    check: 当前真实 .env 主候选仍是豆包
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-switch-check.ts --expect-primary minimax --simulate-visitor-provider minimax
    check: 模拟回滚后主候选 MiniMax 且自动补豆包备候选
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --provider minimax --caller router --turns 3 --fail-primary --fail-primary-mode rate-limit --expect-fallback
    check: 回滚态 MiniMax 限流后真实回退到豆包
    threshold: exit=0
---
# AF-273 · 回滚态候选链保底守卫与故障回退 smoke

## 背景

AF-271 已完成 `doubao → minimax` 回滚演练，但暴露出一个生产级单点：`RenderConfigFactory` 只在 `VISITOR_LLM_PROVIDER=doubao` 时自动补 MiniMax 备候选；切回 `minimax` 时不会自动补豆包。只要 MiniMax 一熔断，整场对练会直接落到兜底句，没有第二候选可切。回滚方案因此只完成了“能切”，没有完成“切了还活着”。

## 目标

1. `RenderConfigFactory` 在显式 `VISITOR_LLM_PROVIDER=minimax` 且未配置 `ENGINE_RENDER_FALLBACK_PROVIDERS` 时，自动补 `doubao` 为备候选；显式 fallback 列表优先，不被覆盖。
2. 未设置 `VISITOR_LLM_PROVIDER` 的既有 MiniMax 部署保持原候选链，零回归。
3. `bin/visitor-switch-check.ts` 的回滚自检输出候选链与 fallback，能机读证明 `minimax → doubao` 已保底。
4. `bin/visitor-render-smoke.ts` 允许回滚态 `--provider minimax` 的故障注入与 `--expect-fallback`，真实跑通「MiniMax 限流 → 豆包回退」。
5. 新增单测覆盖：回滚自动补备、显式 fallback 优先、无 visitor 开关零回归、`ENGINE_RENDER_REQUIRE_FAILOVER=true` 不再因回滚单候选启动失败。

## 非目标

- 不改豆包正向切流的自动补 MiniMax 逻辑。
- 不引入新的 provider、不调整价格与模型映射。
- 不做线上双跑或蓝绿；只做本地可复现配置与真实路由 smoke。
- 不改 401 策略；auth 仍按既有快速降级。
- 不验证 MiniMax 与豆包的语义质量差异。

## 验收

- 回滚自检 `candidates=minimax,doubao`，`fallback=doubao`。
- 回滚态真实限流 smoke：主候选 MiniMax 失败后 `providerHint=doubao`、`fallbackUsed=true`、`degraded=false`、`finishReason=stop`。
- 无 visitor 开关时候选链仍为配置原样，不自动加豆包。
- 定向单测、tsc、lint 全绿；`git diff --stat HEAD -- src/engine-core` 为空。
