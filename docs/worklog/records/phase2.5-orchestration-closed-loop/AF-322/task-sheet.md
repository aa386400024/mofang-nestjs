---
taskId: AF-322
contextId: phase2.5-orchestration-closed-loop
title: BDI 决策与留痕闭环：策略空间、在场事件、跨会话移情、生产 trace
type: implementation
status: backlog
baselineRef: 28d63aab08e14e1ae4e5b58eac3dc6e5d45a5156
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T16:40:00.000Z
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-core/
    - src/engine-adapters/
    - src/admin-debug/
    - src/quality/
    - test/
    - .env.example
    - docs/worklog/pending/
    - docs/worklog/completed/
    - docs/worklog/records/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af322-bdi-decision-trace-closure-2026-11-23.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-core/af322-bdi-residual-closure.spec.ts test/engine-adapters/af322-bdi-residual-closure-adapter.spec.ts test/admin-debug/af322-trace-projection.spec.ts test/engine-core/wp36-session-decay.spec.ts test/engine-adapters/wp42-alliance-config.spec.ts test/config/wp25-env-example-coverage.spec.ts
    check: 定向用例全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型检查（CI 同口径）
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量测试通过
    threshold: exit=0
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链一致
    threshold: exit=0
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包哈希一致
    threshold: exit=0
successCriteria:
  - 规则轨在满足临床前置条件时可主动产出 insight 与 discussing_plans；门槛可注入且非法值回退种子值。
  - 探索门槛下调条件拆分为 understood 与 accepted 双信号，不再用平均值近似。
  - holding_present 与 cold_absent 进入基础 delta 表，方向正确且单回合不越 delta cap。
  - 移情三维跨会话按可配置半衰期回落，核心信念/欲望保持不衰减。
  - 生产 turn trace 追加移情三维、核心信念激活峰值、意图策略与理由，空值/非有限值确定性降级，既有字段名不改。
  - 事件分类器运行口径可观测：admin debug 会话摘要返回 classifier 模式、降级计数与模型标识，便于灰度核对。
  - 定向用例、typecheck、lint、全量测试、events verify、worklog verify 全绿；交付记录含六组机读锚点。
---

# AF-322 · BDI 决策与留痕闭环

## 1. 背景

AF-315/316/317/320 已修完同盟系数、探索时机、决策带宽、规则轨词表与 admin debug 投影，并通过 PR #153 合入 `integrate`。仍有三类未闭环问题：

1. 决策层：规则轨只产出叙述/探索/请求/抗拒/简短回应，不产出 `insight` 与 `discussing_plans`；在场状态事件 delta 为零。
2. 跨会话：移情三维被当作“稳定结构”完全不衰减，与真实关系性移情的回落特征不符。
3. 留痕层：生产 `TurnTrace` 没有移情、核心信念激活、意图策略与理由；线上真实场次无法审计 BDI 决策。

本单以“AI 层确定性测试先通过，再谈真人标定”为验收口径：不做临床有效性宣称，只落可复现的确定性场景、边界断言与遗留项。

## 2. 范围

### 2.1 决策层

- `AllianceThresholds` 增加 `insightMinTurn` / `planMinTurn`，缺省 8 / 12，非法值回退种子值。
- `intention-planner` 新增两个确定性分支：
  - 联盟过探索门槛、深度阻抗低、非首轮、非激活阻断、非回避主导，且存在一条 `observed` 临时信念置信度 ≥ 0.6，轮次 ≥ `insightMinTurn` → `insight`。
  - 达到 `planMinTurn` 且控制型欲望权重 ≥ 0.55，其他安全条件同探索 → `discussing_plans`。
  - `discussing_plans` 优先于 `insight`，避免后段锁在领悟。
- 将 `understood / accepted` 的门槛下调条件拆开：只有二者都达到阈值（0.65 / 0.55）才下调，不再用平均值近似。

### 2.2 在场状态

- `holding_present` 基础 delta：safety +0.004 / bond +0.002 / verbal -0.002。
- `cold_absent` 基础 delta：trust -0.004 / safety -0.002 / bond -0.002。
- 单回合幅度必须低于 `DEFAULT_DELTA_CAP_CONFIG` 的对应 cap，且 20 轮累积不把基线推到越界。

### 2.3 跨会话移情

- `SessionDecayConfig` 增加可选 `transferenceHalfLifeMs`，缺省 90 天；`0` = 显式禁用。
- `applySessionDecay` 对 `transference.positive / negative / dependency` 按半衰期回落；核心信念、短期信念、记忆信念、底层/情境欲望保持不衰减。
- 适配层新增 `ENGINE_DECAY_TRANSFERENCE_HALF_LIFE_MS`；非法值回种子值。

### 2.4 生产留痕

- `TurnTrace.bdiSnapshot` 追加可选字段：`safety`、`bond`、`resistanceDepth`、`transference`、`coreBeliefActivationPeak`。
- `TurnTrace` 追加可选 `intention`（strategy / rationale），空值/非有限值确定性降级。
- 既有 8 个 bdiSnapshot 字段名与类型不改，追加式兼容。
- 分类器运行口径进入 admin debug 会话摘要（只读展示，不参与决策）。

### 2.5 工程治理

- `.env.example` 补齐新键、分类器灰度建议与说明；env 键声明由 AF-323 工具链单统一补齐。

## 3. 非目标

- 不宣称临床有效性；没有真人咨询师在环。
- 不改模型轨 prompt 与判定口径，不切换生产来访者模型。
- 工具链脚本与 `package.json` 的 typecheck/分支名治理由 AF-323 承接。
- 不清理管理台成本字段 `totalCost` 技术债。
- 不提交 `data/phase25-exit/*` 历史取证目录。

## 4. 验收

- 定向用例、全量 typecheck、lint、全量测试、events verify、worklog verify 全绿。
- 交付记录含 gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict 六组机读锚点。
