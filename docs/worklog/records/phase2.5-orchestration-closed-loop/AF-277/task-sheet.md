---
taskId: AF-277
contextId: phase2.5-orchestration-closed-loop
title: 回滚态并发、40 轮长上下文与故障回退组合验证
type: verification
status: backlog
baselineRef: 03a9496ab2e59c73124283590dcaf4a5dd0d0e7d
dependsOn: [AF-276, AF-275, AF-271, AF-268, AF-265]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T13:24:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af277-rollback-concurrency-long-context-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec tsx bin/visitor-switch-check.ts --expect-primary minimax --simulate-visitor-provider minimax
    check: 回滚态候选链 minimax,doubao 且两家 key 可见
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --provider minimax --caller router --turns 3 --concurrency 8
    check: 回滚态并发 8 × 3 轮全部 MiniMax、零降级
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --provider minimax --caller router --turns 3 --concurrency 8 --fail-primary --fail-primary-mode rate-limit --expect-fallback
    check: 回滚态并发 8 下 429 全部回退豆包
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --provider minimax --caller router --turns 40
    check: 回滚态 40 轮长上下文全 MiniMax、零降级、stop
    threshold: exit=0
  - command: pnpm test
    check: 代码零改动回归基线
    threshold: exit=0
---
# AF-277 · 回滚态并发、40 轮长上下文与故障回退组合验证

## 背景

AF-265 只验证了正向（豆包主）并发 8；AF-271 只做了串行回滚切流演练；AF-268 只做了正向 40 轮长上下文。回滚态（来访者主候选 = MiniMax，豆包备候选 = Seed Character）在并发 + 长上下文 + 故障回退三者叠加下的生产表现仍未验证。

## 目标

1. 回滚态候选链自检：`minimax,doubao`，两家 key 均可见。
2. 回滚态并发 8 × 3 轮：全部 MiniMax，fallback=false，degraded=false，finishReason=stop。
3. 回滚态并发 8 × 3 轮 + 429 故障：全部回退豆包，fallback=true，degraded=false。
4. 回滚态 40 轮长上下文：全 MiniMax，零降级；记录 TTFT 区间、prompt tokens 封顶、wall。
5. 不对代码做任何改动；用真实 smoke 取证并写入交付记录。

## 非目标

- 不新增指标、不改候选链、不改路由。
- 不做线上双跑。
- 不验证 500 / timeout 组合（AF-269 / AF-273 已覆盖串行与回滚 9 轮）。

## 验收

- 四条 smoke 全部 exit 0，数字写进交付记录。
- `pnpm test` 全绿，证明本任务零代码改动未引入回归。
- 交付记录含六组机读字段标记。
