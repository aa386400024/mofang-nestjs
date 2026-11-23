---
taskId: AF-359
contextId: phase2.5-orchestration-closed-loop
title: BDI 复审 follow-up：浮点主导判定、否定辖域与跨重启展开
type: fix
status: backlog
baselineRef: b867102dd7cf10f0d30c6b96b21f684a24478d4f
dependsOn: [AF-358]
priorTasks: [AF-358, AF-357, AF-354, AF-349]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3, conventions.md#2.5]
createdAt: 2026-11-23T13:05:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-core/cognition/state-transition.ts
    - src/engine-core/cognition/intention-planner.ts
    - src/engine-core/domain/beliefs.ts
    - src/engine-adapters/wiring/character/character-desire-mapping.ts
    - bin/bdi-readiness-audit.ts
    - test/engine-core/
    - test/engine-adapters/
    - test/config/
    - docs/worklog/completed/
    - docs/worklog/records/
  modules:
    - engine-core
    - engine-adapters
  interfaces:
    - TemporaryBelief
    - BdiSnapshot
artifacts:
  - name: 复审 follow-up 修复
    path: src/engine-core/cognition/state-transition.ts
    kind: code
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af359-bdi-review-followup-2026-11-23.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm exec vitest run test/engine-core/af357-bdi-belief-formation.spec.ts test/engine-core/af358-belief-extraction-matrix.spec.ts test/engine-core/af358-belief-degraded-regression.spec.ts test/engine-core/af359-bdi-review-followup.spec.ts test/engine-adapters/af357-character-desire-mapping.spec.ts test/engine-adapters/af358-character-desire-provenance.spec.ts test/engine-adapters/af359-character-desire-pairing.spec.ts test/engine-adapters/af357-bdi-runtime-config.spec.ts test/engine-core/boundary.spec.ts test/config/wp25-env-example-coverage.spec.ts
    check: 定向测试全绿，过滤器全部命中
    threshold: exit=0 且测试文件数 >= 10
  - command: pnpm test
    check: 全量测试全绿
    threshold: exit=0
  - command: pnpm exec tsx bin/bdi-readiness-audit.ts --out .tmp/af359-audit --strict
    check: 阻断项 0，念安不再因浮点误差被判 dominant
    threshold: exit=0
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包完整
    threshold: exit=0
successCriteria:
  - 念安 `0.68 - 0.58` 的 IEEE-754 发丝差值不再被判 `avoidanceDominant`；惊尘与内置回避型不受影响。
  - 审计与内核使用同一容差口径与同一差值定义，输出 `avoidanceDelta` 四位小数并点名三个 dominant 角色。
  - 否定后缀只排除“否定词紧邻觉察动词”（如 `我似乎没有意识到`）；`我意识到没有人真正关心我`、`我意识到并不需要别人认可` 保留。
  - 跨重启/接续后，持久化旧序号大于本地新序号时，合法展开仍能强化；同一句复读仍不提升置信度。
  - 40 条上限同分时优先保留较新条目；同一 id 不产生重复条目。
  - 映射来源键与标签按 `(key,label)` 对去重，长度保持 1:1，赢家标签排在首位。
  - 不改 12 个阈值数值、愿望演化 5 参数、锁 TTL、时序斜率；不宣称临床有效性。
  - 交付记录含六组机读标记，偏差逐条记录。
---

# AF-359 · BDI 复审 follow-up

> 来源：MiniMax Code 对 AF-358 的只读复审（`docs/worklog/pending/relay-response-AF358-review-20261123-1300.md`）。AF-358 三条 P0 已闭环，本单只处理新发现的 3 条 P1（其中 P1-2 / P1-3 为工程修复，P1-1 为浮点判定 + 审计披露）与低风险 P2。

## 1. 范围

在范围内：

- `intention-planner.ts`：`avoidanceDominant` 比较加浮点容差，不改阈值数值。
- `bin/bdi-readiness-audit.ts`：同一容差口径、`avoidanceDelta`、四位小数、点名 dominant 角色。
- `state-transition.ts`：否定后缀收紧到“否定词紧邻觉察动词”；删除展开分支的序号守卫（复读不强化已成为唯一防线）；40 条上限同分保留较新；同 id 去重。
- `character-desire-mapping.ts`：来源键/标签按对去重、赢家标签首位。
- `beliefs.ts`：只改注释，说明 `evidenceCount` 累计的是展开次数。
- 测试与交付记录。

不在范围内：

- 不改 12 个决策阈值数值、愿望演化 5 参数、锁 TTL、时序斜率。
- 不改 `boundary.spec.ts`、不新增 barrel 公开导出。
- 不做“复读计数”字段（临床口径未拍板，进 backlog）。
- 不把 `insight` 口径改成“展开次数 >= 2”（标定决策，进 backlog）。

## 2. 设计

### 2.1 P1-1 浮点主导判定

`avoidanceDelta = avoid_pain - max(understood, accepted)`；`avoidanceDominant = avoidanceDelta > avoidanceMargin + 1e-9`。念安差值 `0.10000000000000009` 不再越线；惊尘 `0.22`、内置回避型 `0.25` 不变。审计输出同一 `avoidanceDelta` 四位小数。

### 2.2 P1-2 否定辖域

后缀只在“否定词 + 可选再 + 觉察动词（意识到/发现/觉察到/注意到）”时排除；`我意识到没有人…`、`我意识到并不需要…` 保留。前缀仍按“否定词紧邻标记”判定。

### 2.3 P1-3 跨重启展开

删除展开分支的 `seq <= lastSeq` 守卫。理由：复读分支已不提升置信度，膨胀不可能发生；保留守卫只会在持久化旧序号大于本地新序号时静默丢弃合法展开。

### 2.4 P2

- 40 条上限排序键 `(confidence, lastObservedAtTurn)`，同分保留较新。
- push 前按 id 去重；同 id 已存在时只刷新观察痕迹。
- 来源字段按 `(key,label)` 对去重，赢家标签置首。

## 3. 红线

- 分层归属按 `conventions.md` §1.1：纯计算进内核，env/IO 进适配层。
- `src/engine-core` 只改本单列出的三个文件；`boundary.spec.ts` 不改、不新增 public export。
- 心理对话原文不进日志 / 报告 / 审计产物。
- 缺省 `ENGINE_BELIEF_FORMATION_ENABLED=false` 时逐字零回归。

## 4. 闸门

- `pnpm typecheck` 0 error；`pnpm lint` 0 error / 0 warning。
- 定向 10 个测试文件真实命中；全量 `pnpm test` 全绿。
- 审计 `--strict` 阻断 0，念安 `avoidanceDominant=false` 且 `avoidanceDelta=0.1000`。

## 5. 交付记录

`docs/worklog/completed/phase2.5/af359-bdi-review-followup-2026-11-23.md`，含六组机读标记。
