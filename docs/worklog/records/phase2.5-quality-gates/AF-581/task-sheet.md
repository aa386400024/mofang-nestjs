---
taskId: AF-581
contextId: phase2.5-quality-gates
title: 批次有效性门禁消费咨询师侧降级计数并给出可判读比例
type: implementation
status: backlog
baselineRef: d57b5d8d784a331f535ae5ad9c06269457f49809
dependsOn: []
priorTasks: [AF-140, AF-580]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3, conventions.md#5.4]
createdAt: 2026-11-27T20:40:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/auto-practice/practice-batch-health.service.ts
    - test/auto-practice/wp-h-wave2-3-batch-observability.spec.ts
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-quality-gates/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af581-counselor-degraded-gate-2026-11-27.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/wp-h-wave2-3-batch-observability.spec.ts
    check: 批次健康定向单测全绿
    threshold: exit 0
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exit 0
  - command: pnpm lint
    check: lint 0 error
    threshold: exit 0
  - command: pnpm test
    check: 全量测试全绿
    threshold: exit 0
successCriteria:
  - BatchMetrics 新增 counselorDegradedRatio（分母 totalTurns；无轮次时为 0，不产生 NaN）
  - evaluateBatchHealth 在 counselorDegradedRatio >= 0.05 时输出 COUNSELOR_DEGRADED_HIGH 并判 valid=false
  - 既有健康批次（咨询师降级 0）判定保持 valid=true，flags 仍为空
  - 新增定向用例覆盖「0 轮」「低于阈值」「恰好阈值」「高于阈值」四条边界
  - 不改变 visitor 侧降级与既有 fallback / llm_call / counter 三条门禁语义
  - engine-core 零 diff，不新增 migration / env 键 / 依赖
objective: 让批次有效性门禁真正消费咨询师侧降级计数，避免「聚合了但判定不看」导致带系统性咨询师降级的批次仍被当作有效数据用于结论
outOfScope:
  - 不做重试预算标定（IM-062 / IM-064）
  - 不做 50 轮临床验收口径（IM-065）
  - 不做模型轨语料补足（IM-074）
  - 不改 controller / DTO / 前端展示
  - 不调整 0.05 之外的阈值，不引入动态配置
constraints:
  - 阈值复用既有渲染兜底 5% 的可材料性量级，作为同一门禁族的最小新增；不另造第二套阈值真相源
  - 比例计算只依赖既有 BatchMetrics 字段，不新增 DB 查询
  - 纯函数保持纯：evaluateBatchHealth 不读 env、不连 DB、不写日志
  - 心理内容不进日志；本单只处理计数
---

## 背景

`computeBatchMetrics` 已聚合 `counselorDegradedTurns`，但 `evaluateBatchHealth` 只消费 `counterConsistent`（`degraded_turns <= turn_count`）、`llmCallRatio` 与 `renderFallbackRatio`。结果是：咨询师侧出现系统性降级的批次仍可能 `valid=true`，被当作可用于结论的数据。

AF-140 的真实 long 批次与 96 场批次咨询师降级均为 0，说明健康批次不会被误伤；但门禁没有消费该计数，属于「有观测、无判定」。本单补上比例与阈值判定，让门禁闭环。

## 实现口径

1. `BatchMetrics` 增加 `counselorDegradedRatio: number`：`totalTurns > 0 ? counselorDegradedTurns / totalTurns : 0`。
2. 新增常量 `BATCH_HEALTH_COUNSELOR_DEGRADED_RATIO_MAX = 0.05`，与既有 `BATCH_HEALTH_FALLBACK_RATIO_MAX` 同量级，不引入 env。
3. `BatchHealth` 增加同名字段；`BATCH_VALIDITY_FLAGS` 增加 `counselorDegradedHigh: 'COUNSELOR_DEGRADED_HIGH'`。
4. `evaluateBatchHealth` 在 `counselorDegradedRatio >= 阈值` 时 push flag，`valid` 由 flags 统一决定。
5. 既有 test fixture `makeMetrics` 默认 0，确保旧用例判定不变；新增四条边界用例。

## 红线

- 只改两个文件；不碰 controller、DTO、前端、migration、env。
- `engine-core` 零 diff。
- 不把咨询师降级比例写成「临床不合格」——它只是数据可用性门禁。
- 不把阈值做成可配置；后续标定另案。
