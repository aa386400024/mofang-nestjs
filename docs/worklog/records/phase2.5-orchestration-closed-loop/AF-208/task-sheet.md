---
taskId: AF-208
contextId: phase2.5-orchestration-closed-loop
title: 来访者真人度 R2：口语事件计划、话轮形态审计与生成侧重试
type: implementation
status: backlog
baselineRef: ea1bbfaba59fd6d84bbd735240d8a61cfdbc505f
dependsOn: []
priorTasks: [AF-207]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T22:40:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/realism/
    - src/engine-adapters/rendering/
    - test/auto-practice/
    - test/engine-adapters/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af208-visitor-realism-r2-2026-11-20.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/af208-realism-event.spec.ts test/auto-practice/af208-realism-audit.spec.ts test/engine-adapters/af208-realism-retry.spec.ts
    check: R2 定向回归全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 后端类型检查 0 error
    threshold: exit=0
  - command: pnpm exec eslint --no-cache "{src,test}/**/*.ts"
    check: lint 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量测试 0 failed
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty
successCriteria:
  - 真人度 active 模式按角色/状态/场景产出确定性口语事件计划，事件词表具体可执行，风险轮为空。
  - off/audit 模式 prompt 与现状逐字一致；active 模式才追加事件候选，不改变既有优先级。
  - 生成侧审计能识别话轮形态硬违约与不流利配额超限；审计只读文本，不写原文日志。
  - 聚合渲染在 active 模式下对硬违约最多重试一次，重试仍违约则接受可读文本并记信号，不降级成兜底句。
  - 流式渲染不重试，只审计；off/audit 模式零额外调用。
  - 定向测试、类型检查、lint、全量测试全绿；engine-core 零 diff；交付记录与回执齐全。
---

# AF-208 · 来访者真人度 R2

## 目标

把 R1 的“这一轮怎么说话”从 prompt 配额推进到生成侧可执行层：

1. **口语事件计划**：为角色、状态、场景选择具体的填充词、停顿、改口、半截话、重复、拖长音候选，限定上限，由模型按需取用。
2. **话轮形态审计**：对生成文本做确定性检查，识别明确违约（该短却长篇、该问回却没问、该改口却没改、戒备挡回缺失、配额超限）。
3. **生成侧重试**：仅在 `RENDER_REALISM_MODE=active` 时，对明确违约在同一候选上最多重试一次；重试仍违约不降级，保留可读台词并记信号。
4. **流式边界**：流式已经出声，不做重试，只审计；避免“说完再撤回”。

## 硬约束

- 不碰 `src/engine-core`。
- 默认 `off`，生产行为不变；`audit` 只审计不重试不注入。
- 不新增 env 键，不扩大部署契约。
- 不随机改写字句，不向台词注入固定模板；重试只追加“重说要求”，由模型重新生成。
- 日志只记 mode/scene/role/state/shape/违约类型/事件计数，不记台词原文。
- 风险轮不靠不流利撑真人感；安全信息优先清楚。

## 验收边界

- 本单只做“生成侧 R2”，不宣称临床有效性；临床口径仍是“临床代理门槛 + 工程闸门”。
- R3—R5（场景矩阵扩展、临床规则细化、度量与 AI 双盲验收）不在本单范围。
