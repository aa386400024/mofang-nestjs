---
taskId: AF-584
contextId: phase2.5-quality-gates
title: 角色级不流利配置管道
type: implementation
status: backlog
baselineRef: abf50ef7b3af594da72fc83059b46c9d516984fb
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T02:42:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/rendering/
    - src/engine-adapters/wiring/character/
    - src/engine-adapters/wiring/engine-turn.service.ts
    - src/engine-adapters/wiring/engine-stream-backend.adapter.ts
    - src/shared/realism/
    - src/migration/1714900000058-AddCharacterProfileDisfluencyConfig.ts
    - src/migration/index.ts
    - bin/ormconfig.ts
    - test/auto-practice/af204-realism.spec.ts
    - test/engine-adapters/wp9b-db-character-resolver.spec.ts
    - test/engine-adapters/character-profile-fixtures.ts
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-quality-gates/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af584-role-disfluency-config-2026-11-28.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/af204-realism.spec.ts test/engine-adapters/wp9b-db-character-resolver.spec.ts
    check: 定向单测全绿
    threshold: 0 failed
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exit 0
  - command: pnpm lint
    check: Lint 0 error
    threshold: exit 0
  - command: git diff --stat HEAD -- src/engine-core
    check: 内核零改动
    threshold: empty output
successCriteria:
  - character_profiles 新增可空列 disfluency_level 与 disfluency_density，并完成实体、migration、两处 migration 注册点
  - ResolvedCharacter 通过渲染侧侧通道条件携带两字段，不进内核 CharacterProfile
  - AdaptiveRenderSpec / TurnSessionContext / EngineTurnOpenOptions 条件透传两字段，缺省时 prompt 逐字不变
  - resolveVisitorRealismRuntime 消费两字段：档位影响不流利配额上限，密度按 0.5 权重做档位修正；风险轮仍强制归零
  - 单测覆盖 null 零回归、light/none/heavy、密度上下修正、风险轮优先级、DB resolver 条件携带与非法档位忽略
  - 定向测试、typecheck、lint 全绿，engine-core 零 diff
objective: 把 Phase3 §5.4 的角色级不流利配置从文档落到可透传、可测试、默认零回归的渲染侧管道
outOfScope:
  - 不标定任何角色具体数值，首版全部 NULL
  - 不重写 R1 prompt 文案，不改 RENDER_REALISM_MODE 默认值
  - 不改 admin 前端或新增角色管理接口字段
constraints:
  - 内核 CharacterProfile 与 RenderSpec 不得改动
  - 两处 migration 注册点 bin/ormconfig.ts 与 src/migration/index.ts 必须同步
  - 所有新字段缺省不得改变现有 prompt 逐字输出
---

# AF-584 · 角色级不流利配置管道

## 1. 背景

Phase3 文字真人度计划 §5.4 要求角色级 `disfluency_level` / `disfluency_density` 配置，但当前只有 R1 的通用配额层，角色库没有表达"这个角色天生更磕巴/更顺"的字段。

## 2. 目标

- 在适配层角色实体上新增两个可空列，旧行保持 NULL。
- 按 `verbalVoice` 同构的渲染侧侧通道透传到 `VisitorRealismContext`，不修改内核 `CharacterProfile` / `RenderSpec`。
- `disfluency_level` 影响配额上限；`disfluency_density` 作为 0.5 权重的档位修正量。
- 缺省（NULL / 非法值）行为与 AF-204 逐字一致；风险轮配额仍强制归零。

## 3. 非目标

- 不标定任何角色具体数值（首版全部 NULL，数值待基线批次后另立校准任务）。
- 不做 prompt 文案重写，不改变现有 R1 事件层结构。
- 不改 `RENDER_REALISM_MODE` 默认值。
