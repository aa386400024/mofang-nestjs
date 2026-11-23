---
taskId: AF-349
contextId: phase2.5-orchestration-closed-loop
title: BDI 决策链语义与状态机制修复批次
type: implementation
status: backlog
baselineRef: b7ce8628e599c6c5367e3240bfd3c6b19a22c07e
dependsOn: []
priorTasks: [AF-315, AF-322, AF-345]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-23T07:30:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-core/cognition/
    - src/engine-core/domain/
    - src/engine-core/in-memory/
    - src/engine-adapters/cognition/
    - src/engine-adapters/wiring/
    - src/engine-adapters/rendering/
    - test/engine-core/
    - test/engine-adapters/
    - test/quality/
    - bin/
    - docs/worklog/pending/
    - docs/worklog/completed/
    - docs/worklog/records/
  modules:
    - engine-core
    - engine-adapters
  interfaces:
    - ClassifyContext
    - EngineTurnInput
    - BdiSnapshot
    - TransitionStateOptions
artifacts:
  - name: 规则分类器语义 v2
    path: src/engine-core/cognition/rule-based-classifier.ts
    kind: code
  - name: 愿望演化与情境愿望
    path: src/engine-core/domain/desires.ts
    kind: code
  - name: 意图锁
    path: src/engine-core/cognition/intention-planner.ts
    kind: code
  - name: 时序权重曲线
    path: src/engine-core/cognition/state-transition.ts
    kind: code
  - name: 回放取证脚本
    path: bin/af347-event-classifier-v2-replay.ts
    kind: code
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af349-bdi-decision-chain-semantic-hardening-2026-11-23.md
    kind: report
  - name: 回放报告
    path: docs/worklog/completed/phase2.5/af349-event-classifier-v2-replay-report-2026-11-23.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm exec vitest run test/engine-core/af349-bdi-decision-chain.spec.ts test/engine-adapters/af349-rule-classifier-v2.spec.ts test/quality/af349-event-classifier-v2-replay.spec.ts test/engine-core/boundary.spec.ts
    check: 定向测试全绿
    threshold: exit=0
  - command: pnpm test
    check: 全量测试全绿
    threshold: exit=0
successCriteria:
  - 规则轨分类器提供 legacy / v2 两档语义；legacy 逐字保持旧口径，v2 默认由装配层注入，覆盖否定抑制、长词遮盖消歧、强度折算、上一轮来访话语上下文。
  - 11 场真实 debug 逐字稿回放产出旧 vs v2 事件分布与翻转明细；不把差异包装成临床有效性。
  - 愿望层新增情境愿望生成与底层愿望更新纯函数，配置门控，缺省不改变既有状态轨迹。
  - 意图锁落 BdiSnapshot 可选字段并提供配置门控，缺省不锁定；锁定后跨轮可复现。
  - 时序权重 linear_decay / recency / window 三形态纯函数落地，缺省 none 路径逐字不变。
  - 交付记录含 gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict 六组机读标记。
  - 不宣称临床有效性；不把工程种子值写成临床标定结果。
---

# AF-349 · BDI 决策链语义与状态机制修复批次

本单处理 BDI 决策链中**能由代码与现有语料闭环**的结构缺口：规则分类器语义、愿望演化、意图锁、时序权重曲线。临床幅度标定、100 场审议质量验收、真实督导在环验证不在本单范围内，明确留作后续标定批次。

## 边界

- 规则分类器 legacy 档必须逐字保持旧口径；v2 档只做语义修正，不新增临床幅度。
- 愿望演化 / 意图锁 / 时序曲线默认关闭或保持 `none`；本单只负责机制落地、可复现与单测覆盖，是否开启属批次决策。
- 不修改 `src/engine-core` 之外的业务红线；不改 env 模板以外的部署配置。
- 不用构造语料冒充真实语料；回放只读 `data/debug-sessions`，报告只出统计与翻转明细，不输出原始对话文本。
- 回放脚本放 `bin/`，避免越出 executor 的 `scripts/` 资源域。
