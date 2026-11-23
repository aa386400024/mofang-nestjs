---
taskId: AF-354
contextId: phase2.5-orchestration-closed-loop
title: BDI 决策链工程闭环：启用通道、跨会话语义与阈值端口化
type: implementation
status: backlog
baselineRef: ed4bbd2d83a5a2c33c0f0a5877fbbee09cbe0e72
dependsOn: []
priorTasks: [AF-349, AF-315, AF-322, AF-351]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3, conventions.md#2.5]
createdAt: 2026-11-23T10:45:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-core/cognition/
    - src/engine-core/domain/
    - src/engine-core/in-memory/
    - src/engine-adapters/wiring/
    - src/engine-adapters/deliberation/
    - src/engine-adapters/persistence/
    - test/engine-core/
    - test/engine-adapters/
    - test/config/
    - bin/
    - .env.example
    - docs/worklog/completed/
    - docs/worklog/records/
  modules:
    - engine-core
    - engine-adapters
  interfaces:
    - AllianceThresholds
    - AllianceConfig
    - EngineSessionOptions
    - IntentionLockConfig
    - DesireEvolutionConfig
    - TransitionStateOptions
artifacts:
  - name: BDI 运行时开关解析与装配
    path: src/engine-adapters/wiring/bdi-runtime.config.ts
    kind: code
  - name: 决策阈值端口化
    path: src/engine-core/cognition/alliance-config.ts
    kind: code
  - name: 意图锁与愿望演化生产装配
    path: src/engine-adapters/wiring/engine.module.ts
    kind: code
  - name: 跨会话瞬时状态清理
    path: src/engine-core/in-memory/in-memory-engine-session.ts
    kind: code
  - name: BDI 就绪度只读审计
    path: bin/bdi-readiness-audit.ts
    kind: code
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af354-bdi-engineering-closure-2026-11-23.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm exec vitest run test/engine-core/af354-bdi-engineering-closure.spec.ts test/engine-adapters/af354-bdi-runtime-config.spec.ts test/engine-core/boundary.spec.ts test/config/wp25-env-example-coverage.spec.ts
    check: 定向测试全绿
    threshold: exit=0
  - command: pnpm test
    check: 全量测试全绿
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: 内核改动限定在任务单批准的 cognition/domain/in-memory 纯层
    threshold: 仅本单授权文件
successCriteria:
  - 愿望演化 / 意图锁 / 时序权重三项 AF-349 机制新增 env 解析与生产装配通道；缺省保持关闭或 none，行为与改造前逐字一致。
  - 意图规划器中 11 个硬编码决策阈值进入 AllianceConfig 决策阈值端口，缺省值逐字等于现有常量，可由部署 env 覆写。
  - 跨会话接续时清空意图锁并停用上一场的情境愿望，避免会话内轮次号跨场"续命"；以纯函数与会话层测试覆盖。
  - 内核意图锁开启时，审议侧 Redis 意图锁强制关闭并打启动期告警；两套锁不再同时生效。
  - 生产环境使用 memory 形态 BDI 状态存储时，装配期输出告警（不改变缺省，不引入 Redis 强依赖）。
  - evolveDesires 的 changed 字段按真实差异返回，不再恒为 true。
  - 新增只读审计 CLI：输出 8 个内置/DB 角色对四个内核愿望键的覆盖矩阵与不可达策略，不调用模型、不连库、不读心理原文。
  - 交付记录含 gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict 六组机读标记。
  - 不宣称临床有效性；不新造临床数值；不可由工程闭环解决的事项显式登记 backlog。
---

# AF-354 · BDI 决策链工程闭环：启用通道、跨会话语义与阈值端口化

## 1. 背景

AF-349 已把愿望演化、意图锁、时序权重做成内核纯函数，但生产装配只注入 cap / 人格 / 同盟 / delta 表 / 会话衰减，三项新机制没有任何 env 入口；意图规划器中仍有 11 个硬编码阈值，部署侧无法按角色或批次调参；接续会话时 `turnIndex` 从 0 重起，而意图锁与情境愿望的 TTL 使用会话内轮次，导致上一场的瞬时状态在新一场继续生效；内核意图锁与 WP68 的 Redis 审议锁是两套机制，同时开启会产生双重锁语义；BDI 状态缺省存 memory，生产误配时无告警。

本单只处理**工程可闭环**的部分：启用通道、跨会话语义、阈值端口化、可观测性。临床语义设计（角色愿望分类与决策映射、短期信念生成、来访反应回灌、MindGuard 临床层）不在本单擅自改，统一进 backlog。

## 2. 范围

在范围内：

- `src/engine-core/cognition/alliance-config.ts`、`intention-planner.ts`：决策阈值端口化，缺省逐字不变。
- `src/engine-core/domain/desires.ts`：只修 `changed` 语义，不改任何愿望数值。
- `src/engine-core/in-memory/in-memory-engine-session.ts`：接续时清理跨会话不应继承的瞬时状态。
- `src/engine-adapters/wiring/`：新增三项机制 env 解析与装配；生产 memory 存储告警。
- `src/engine-adapters/deliberation/`：锁优先级收敛。
- `.env.example`：新增键显式声明并逐条生效。
- `bin/bdi-readiness-audit.ts`：只读审计。
- 测试与交付记录。

明确不在范围内：

- 不改 `boundary.spec.ts`；不新增内核公开导出（阈值扩展只加既有接口字段）。
- 不改模型轨 / 审议缺省形态；不打开任何未标定机制。
- 不改角色种子内容、不改 `src/engine-adapters/wiring/character/` 下的愿望键与数值。
- 不新增 migration / 表结构；不连真实 DB/Redis 做验收。
- 不碰 `admin-dashboard/`、Flutter 客户端、`scripts/`、`typings/`。
- 不做临床标定，不把工程种子写成临床结论。

## 3. 交付物

- 交付物 1：`bdi-runtime.config.ts` —— 解析 `ENGINE_DESIRE_*` / `ENGINE_INTENTION_LOCK_*` / `ENGINE_TIMING_WEIGHT_*`，非法值逐项回退内核种子；纯函数，不读 env。
- 交付物 2：`AllianceConfig.thresholds` 扩展 11 个决策阈值字段；`resolveAllianceThresholds` 逐项校验并回退；`intention-planner` 改读端口。
- 交付物 3：`in-memory-engine-session` 接续清理纯函数（清锁、停用情境愿望）与调用点。
- 交付物 4：`engine.module` 装配三项配置；内核锁开启时审议锁降为 0 并告警；生产 memory 存储告警。
- 交付物 5：`bin/bdi-readiness-audit.ts` 只读审计（角色 × 四键矩阵、不可达策略、机制开关状态）。
- 交付物 6：测试 —— 纯函数单测 + env 解析 + 接续语义 + 装配守卫；不起 Nest 容器、不连 DB。

## 4. 红线

- 分层归属按 `conventions.md` §1.1：纯计算进内核，env/IO 进适配层；内核零 `process.env`。
- 心理对话原文禁止进日志 / console / 报告；审计只输出键名、数值与布尔。
- `src/engine-core` 改动仅限任务单列出的三个既有文件；`boundary.spec.ts` 不改。
- 缺省行为逐字不变：三项机制默认关 / `none`；阈值缺省等于现值；memory 存储缺省不变。
- 提交 / 推送按发布分层口径执行；L3 经受保护 PR，不直推 integrate。

## 5. 闸门

- `pnpm typecheck` 0 error；`pnpm lint` 0 error / 0 warning。
- 定向：`test/engine-core/af354-bdi-engineering-closure.spec.ts`、`test/engine-adapters/af354-bdi-runtime-config.spec.ts`、`test/engine-core/boundary.spec.ts`、`test/config/wp25-env-example-coverage.spec.ts`。
- 全量：`pnpm test` 全绿，记录真实数字。
- `git diff --stat HEAD -- src/engine-core` 只含授权文件。

## 6. 交付记录

`docs/worklog/completed/phase2.5/af354-bdi-engineering-closure-2026-11-23.md`，含六组机读标记。

## 7. 回写清单

- [ ] 交付记录写入固定路径
- [ ] 任务单归档、状态索引与事件链由 CLI 写入
- [ ] 回写 phase2.5 WP 清单与阶段入口
- [ ] backlog 登记临床语义项
- [ ] 提交分组核对，仅本单文件
- [ ] 一行 commit message
