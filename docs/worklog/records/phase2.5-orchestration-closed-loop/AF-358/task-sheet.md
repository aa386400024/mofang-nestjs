---
taskId: AF-358
contextId: phase2.5-orchestration-closed-loop
title: BDI 评审返修：信念生成 P0 语义修复与映射信息保全
type: fix
status: backlog
baselineRef: c365be2b
dependsOn: [AF-357]
priorTasks: [AF-357, AF-354, AF-349]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3, conventions.md#2.5]
createdAt: 2026-11-23T12:45:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-core/cognition/state-transition.ts
    - src/engine-core/domain/beliefs.ts
    - src/engine-core/domain/engine-session.types.ts
    - src/engine-core/domain/character-profile.ts
    - src/engine-core/domain/desires.ts
    - src/engine-core/domain/bootstrap.ts
    - src/engine-core/in-memory/in-memory-engine-session.ts
    - src/engine-adapters/rendering/turn-render-orchestrator.ts
    - src/engine-adapters/wiring/bdi-runtime.config.ts
    - src/engine-adapters/wiring/engine.module.ts
    - src/engine-adapters/wiring/character/
    - bin/bdi-readiness-audit.ts
    - test/engine-core/
    - test/engine-adapters/
    - test/config/
    - .env.example
    - docs/worklog/completed/
    - docs/worklog/records/
  modules:
    - engine-core
    - engine-adapters
  interfaces:
    - TemporaryBelief
    - EngineTurnInput
    - BeliefOperatorConfig
    - TransitionStateOptions
    - UnderlyingDesireSeed
    - UnderlyingDesire
artifacts:
  - name: 信念生成 P0/P1 语义修复
    path: src/engine-core/cognition/state-transition.ts
    kind: code
  - name: 来访发言序号端口
    path: src/engine-core/domain/engine-session.types.ts
    kind: code
  - name: 角色愿望来源保全
    path: src/engine-adapters/wiring/character/character-desire-mapping.ts
    kind: code
  - name: 句式矩阵测试
    path: test/engine-core/af358-belief-extraction-matrix.spec.ts
    kind: test
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af358-bdi-review-remediation-2026-11-23.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm exec vitest run test/engine-core/af357-bdi-belief-formation.spec.ts test/engine-core/af358-belief-extraction-matrix.spec.ts test/engine-core/af358-belief-degraded-regression.spec.ts test/engine-adapters/af357-character-desire-mapping.spec.ts test/engine-adapters/af358-character-desire-provenance.spec.ts test/engine-adapters/af357-bdi-runtime-config.spec.ts test/engine-adapters/af106-character-pool.spec.ts test/engine-core/boundary.spec.ts test/config/wp25-env-example-coverage.spec.ts
    check: 定向测试全绿，过滤器全部命中
    threshold: exit=0 且测试文件数 >= 9
  - command: pnpm test
    check: 全量测试全绿
    threshold: exit=0
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包与取消指针完整
    threshold: exit=0
  - command: pnpm exec tsx bin/bdi-readiness-audit.ts --out .tmp/af358-audit --strict
    check: 阻断项 0
    threshold: exit=0
successCriteria:
  - 同一句来访原话在连续降级渲染轮里只计一次观察：内核接收会话内单调的 priorVisitorSeq，同一序号不重复提升置信度或证据计数；缺省不传序号时既有行为逐字不变。
  - 否定式过滤按“否定词紧邻标记”判定，覆盖标记后置否定（我似乎没有意识到…），且不误伤“我发现我并不开心”这类否定宾语。
  - 问句过滤同时识别句中疑问结构（是不是 / 有没有 / 会不会 / 为什么等）与句尾语气词；第三人称转述按“第三方主体 + 言语动词”识别，但不拦来访对第三方的观察。
  - 逐字复读不再提升置信度，只刷新最近观察轮次与序号；只有同一条被展开（新句包含旧句且更长）才强化，增量随证据次数递减。
  - 信念生成种子与 reflectiveBeliefGate 在装配期做交叉校验：base >= gate 或 base + reinforcement <= gate 时输出告警，不静默改变策略分布。
  - 角色愿望映射保留被合并条目的原始键与标签（sourceKeys/sourceLabels），DB 种子负载与快照可追溯，不把次级诉求从数据面抹掉。
  - temporaryBeliefs 在生成开启时受条数上限保护，按置信度保留高价值条目，避免原文条目无界增长。
  - 审计 CLI 输出 avoidanceDominant 与策略收窄事实，并区分“映射让信号首次可计算”与“角色本身不适合计划讨论”。
  - 修复两处假绿断言，新增中文句式矩阵与降级轮回归，定向测试文件全部真实命中。
  - 交付记录含 gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict 六组机读标记，偏差逐条记录。
  - 不改 12 个决策阈值、愿望演化 5 参数、锁 TTL、时序斜率；不宣称临床有效性。
---

# AF-358 · BDI 评审返修：信念生成 P0 语义修复与映射信息保全

> 来源：MiniMax Code 对 AF-357 的独立只读评审（`docs/worklog/pending/relay-response-AF357-review-20261123-1200.md`）。AF-357 已归档，本单承接其 P0 / P1 与低风险 P2，不修改 AF-357 的归档记录。

## 1. 背景

AF-357 补齐了角色愿望映射与短期信念生成，但独立评审复现出三条 P0：同一句来访原话在连续降级渲染轮里被重复计分、否定式过滤窗口锚错位置、问句过滤只查句尾。当前 `ENGINE_BELIEF_FORMATION_ENABLED` 缺省关闭，因此 P0 尚未在线上生效；但一旦开启就会把“系统替来访宣布领悟”变成可复现行为，必须在开启前修掉。

同时，角色愿望映射把同一内核键的多条角色愿望合并成一条，次级诉求与标签从快照和 DB 种子负载里消失；这是一次未声明的语义与数据改写，需要保留来源信息。

## 2. 范围

在范围内：

- `src/engine-core/cognition/state-transition.ts`：来访发言序号判定、否定/问句/第三人称判定、复读与展开语义、条数上限、哈希边界修正。
- `src/engine-core/domain/beliefs.ts`、`engine-session.types.ts`：可选序号与来源字段，旧快照兼容。
- `src/engine-core/domain/character-profile.ts`、`desires.ts`、`bootstrap.ts`：愿望来源键与标签的可选承载。
- `src/engine-core/in-memory/in-memory-engine-session.ts`：序号透传与两条演化路径同口径。
- `src/engine-adapters/rendering/turn-render-orchestrator.ts`：真实来访腿序号登记、降级轮不自增、会话关闭清理、历史恢复自愈。
- `src/engine-adapters/wiring/bdi-runtime.config.ts`、`engine.module.ts`、`.env.example`：种子与门槛交叉告警、文档事实修正。
- `src/engine-adapters/wiring/character/`：映射保留来源键与标签，四条装配路径同口径。
- `bin/bdi-readiness-audit.ts`：avoidanceDominant 与策略收窄输出、版本更新。
- 测试：句式矩阵、降级轮回归、来源保全、既有 AF-357 断言适配。
- 交付记录与回执。

明确不在范围内：

- 不改 12 个决策阈值、愿望演化 5 参数、锁 TTL、时序斜率。
- 不新增 migration / 表结构；不改 admin-dashboard / Flutter / scripts / typings。
- 不把“复读”重新解释为整合领悟；不做临床标定。
- 不采集、不记录、不输出任何心理对话原文到日志 / 报告 / 审计产物。

## 3. 修复设计

### 3.1 P0-1 同一句原话重复计分

- `EngineTurnInput.priorVisitorSeq?: number`，`TemporaryBelief.lastObservedAtVisitorSeq?: number`。
- 门面为每条真实来访腿分配会话内单调序号；降级轮不追加来访腿，因此序号不变。
- 内核仅在序号严格变大时计为新观察；缺省不传序号时不做序号判定，既有行为逐字不变。
- 会话关闭时与 history 同生命周期清理；`restoreHistory` 后按历史中来访腿重建序号，避免脏序号。

### 3.2 P0-2 / P0-3 句式判定

- 否定词表 `没有 / 没 / 不 / 未`，判定为“紧邻标记前后任一侧”，不是“标记前 3 字”。
- 问句双判：句尾语气词 + 句中疑问结构词表。
- 第三人称转述按“第三方主体 + 短窗口言语动词”识别；来访对第三方的观察（我发现她总是这样）保留。
- 切句符补充逗号、省略号、全角句点，避免后半句并入同一候选。

### 3.3 P1-1 复读与展开

- 规范化文本完全相同：只刷新 `lastObservedAtTurn` / `lastObservedAtVisitorSeq`，置信度与证据计数不动。
- 新句包含旧句且更长：视为同一条的展开，更新 statement、置信度与证据计数；增量按现有证据次数递减。
- 旧快照字段缺省仍可读，旧行为兼容。

### 3.4 P1-2 映射信息保全

- `UnderlyingDesireSeed` 增加可选 `sourceKeys?: string[]` / `sourceLabels?: string[]`；映射合并时把同组原始键与标签累积到合并记录。
- DB 种子负载与快照保留来源字段；解析路径继续以映射后四键驱动内核，来源字段只作审计与督导追溯。
- 交付记录显式登记“seed 脚本会把合并形态写回 character_profiles”的行为变化与回滚办法。
- 审计输出 `avoidanceDominant` 与“惊尘恒为 recounting”的静态事实，不把其解释成临床结论。

### 3.5 P1-3 / P1-5

- 装配期交叉校验：`base >= reflectiveBeliefGate` 告警；`base + reinforcement <= reflectiveBeliefGate` 告警；说明“复读不再提升置信度”的语义变化。
- 生成开启时 `temporaryBeliefs` 最多保留 40 条，按置信度保留高价值条目；关闭时不裁剪，逐字零回归。
- `.env.example` 修正“连续复述”与 insight 最早轮次（`insightMinTurn = 8`）的事实错误。

## 4. 红线

- 分层归属按 `conventions.md` §1.1：纯计算进内核，env/IO 进适配层；内核零 env、零网络、零 prompt。
- `src/engine-core` 改动仅限任务单列出的七个既有文件；`boundary.spec.ts` 不改，且不新增 barrel 导出。
- 缺省行为逐字不变：`ENGINE_BELIEF_FORMATION_ENABLED=false` 时不生成、不裁剪任何信念。
- 心理对话原文禁止进日志 / console / 报告；审计只输出键名、数值、布尔与计数。
- 提交 / 推送按发布分层口径执行；L3 经受保护 PR，不直推 integrate。

## 5. 闸门

- `pnpm typecheck` 0 error；`pnpm lint` 0 error / 0 warning。
- 定向 9 个测试文件全部真实命中；全量 `pnpm test` 全绿，记录真实数字与机器状态。
- `git diff --stat HEAD -- src/engine-core` 只含授权文件。
- `node scripts/orchestration/cli.mjs worklog verify --strict` 与审计 `--strict` 均通过。

## 6. 交付记录

`docs/worklog/completed/phase2.5/af358-bdi-review-remediation-2026-11-23.md`，含六组机读标记。

## 7. 回写清单

- [ ] 交付记录写入固定路径
- [ ] 任务单归档、状态索引与事件链由 CLI 写入
- [ ] 回写 phase2.5 WP 清单与阶段入口
- [ ] backlog 登记 P2-3 / P2-5 / P2-6 / P2-8 与闸门过滤器校验
- [ ] 提交分组核对，仅本单文件
- [ ] 一行 commit message
