---
taskId: AF-108
contextId: phase2.5-exit4-quality-remediation
title: 推理块零泄漏与 8 角色池扩展
type: implementation
status: backlog
baselineRef: dcd3ebd2345c504ee57e0ec8b69b362c09085115
dependsOn: [AF-102, AF-103, AF-105, AF-107]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T22:55:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/llm/
    - src/auto-practice/counselor/policy/visible-output.ts
    - src/engine-adapters/rendering/llm-render.adapter.ts
    - src/engine-adapters/wiring/character/
    - bin/seed-character-profiles.ts
    - test/shared/
    - test/engine-adapters/
    - docs/worklog/pending/
    - docs/worklog/completed/
  modules:
    - engine-adapters-rendering
    - engine-adapters-character
    - auto-practice-counselor-policy
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af108-reasoning-leak-and-roster-delivery-2026-11-18.md
    kind: report
gates:
  - command: corepack pnpm exec vitest run test/shared/af106-reasoning-text.spec.ts test/engine-adapters/af106-character-pool.spec.ts test/engine-adapters/wp6-llm-render.spec.ts test/engine-adapters/wp8b-stream-render.spec.ts
    check: 推理清洗与角色池定向单测全绿
    threshold: failed=0
successCriteria:
  - 聚合输出与流式输出中的 `<think>` 推理块在渲染层统一剥离，逐字稿/历史/来访者引擎上下文零泄漏
  - 流式切分标签时不把半截 `<think>` 或推理内容下发给 TTS/字幕
  - 只有推理块或截断后无完整句时按候选失败切备，不静默返回成功
  - B 类 4 个 DB-only 角色具备内容种子，与 A 类合计 8 个 approved profile
  - 角色池单测证明 8 个 profile id 互不重复、核心信念无 unspecified 占位、基线数值与标定表一致
  - 生产 seed 脚本先灌 B 类内容再执行基线校准
  - tsc 0 error，定向 eslint 0 error / 0 warning，engine-core 零 diff
  - 不新造第二份推理正则/角色数值真相源
---
# AF-108 推理块零泄漏与 8 角色池扩展

## 背景

出口④质量判读的 96 场批次全绿，但逐字稿里存在 `<think>` 推理块泄漏：模型把内部推理内联在
content 里，渲染层未剥离，逐字稿/历史/来访者引擎上下文都被污染。同时批次脚本按 8 个 slug
选题，库里只有 4 个 approved 角色，角色池实际只跑 4 位。

AF-106 首次登记后被 `scope-domain-conflict` 拦下（executor card 未声明 `bin/`），
改由 AF-107 先补卡片资源域，再以本任务（AF-108）承接实现。

## 目标

1. 在渲染层统一剥离推理块，聚合与流式两条路径都不泄漏；
2. 流式按 chunk 切分标签时不把半截标签/推理下发给 TTS/字幕；
3. 把 B 类 4 个 DB-only 角色补成完整内容种子，角色池达到 8 位。

## 非目标

- 不改模型 prompt 去“求它别想”；这是渲染层出口治理，不依赖模型自觉。
- 不重写逐字稿/历史数据；存量数据由后续重跑批次覆盖。
- 不改内核会话状态机、不碰 engine-core。

## 实现要点

- 新增 `src/shared/llm/reasoning-text.ts` 作为推理清洗唯一真相：
  `removeReasoningBlocks` / `stripReasoningBlocks` / `safeVisiblePrefix`；
- `llm-json-payload.ts` 与 counselor `visible-output.ts` 改为委托同一实现，消除三份正则；
- 聚合渲染在空内容判定与截断保护**之前**剥离；流式新增可见前缀过滤，句边界缓冲只收可见字符；
- B 类角色新增 `character-profile.db-only.seed.ts`，数值/台词指纹复用标定表，
  `seed-character-profiles.ts` 在基线校准前先灌内容。

## 验收

- 定向单测全绿；tsc / eslint 0 问题；engine-core 零 diff；
- 生产 seed 后 8 角色 approved，可被批次入队校验接受；
- 后续真实批次逐字稿 `<think>` 占比为 0。
