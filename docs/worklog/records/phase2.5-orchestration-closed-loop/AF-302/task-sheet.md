---
taskId: AF-302
contextId: phase2.5-orchestration-closed-loop
title: 渲染故障矩阵一键自证验收器
type: implementation
status: backlog
baselineRef: 3aad9884c2c3a7722599003fd56dbbd9d6b42a2d
dependsOn: []
priorTasks: [AF-295, AF-299, AF-300]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3]
createdAt: "2026-11-22T19:30:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - bin/visitor-render-acceptance.ts
    - bin/lib/render-acceptance-checks.ts
    - test/engine-adapters/af302-render-acceptance-checks.spec.ts
    - docs/runbooks/render-telemetry-alerting.md
    - docs/worklog/completed/phase2.5/af302-render-acceptance-2026-11-22.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-302/
  modules: [engine-adapters]
  interfaces: []
artifacts:
  - name: AF-302 交付记录
    path: docs/worklog/completed/phase2.5/af302-render-acceptance-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec tsx bin/visitor-render-acceptance.ts
    check: 五条真实故障场景逐条自证
    threshold: exit=0 且 PASS 5 / FAIL 0
  - command: pnpm exec vitest run test/engine-adapters/af302-render-acceptance-checks.spec.ts
    check: 断言与 JSON 提取纯函数单测
    threshold: exit=0 且 0 failed
successCriteria:
  - 新增 `bin/visitor-render-acceptance.ts`，一条命令跑完五类故障场景（双 5xx / 双首包超时 / 双 401 / 双连接失败 / 单候选首包后停摆），逐条比对真实进程内指标并打印 PASS/FAIL 表。
  - 断言逻辑抽到 `bin/lib/render-acceptance-checks.ts` 纯函数：按指标名+标签求和、缺失为 0、支持 equals/atLeast/atMost，全部可单测。
  - 任一场景指标不符、smoke 退出码非 0 或报告不可解析 → FAIL 且进程退出码 1；`--keep-going` 可跑完全部再看结果。
  - 支持 `--only <id,id>` 子集执行；未知 id 明确报错。
  - Runbook §5.1 增加「一键自证」入口、退出码语义与「进程内增量、不是线上累计值」的口径提醒。
  - 反向验证：故意把一条期望改错，验收器必须精确报出期望值与真实值并退出 1。
  - 闸门：定向测试全绿、typecheck 0、全量 lint 0、全量测试全绿、`src/engine-core` 零改动。
plannedArtifacts:
  - name: AF-302 交付记录
    path: docs/worklog/completed/phase2.5/af302-render-acceptance-2026-11-22.md
    kind: report
---

# AF-302 · 渲染故障矩阵一键自证验收器（implementation / executor）

> 状态：📋 待执行（2026-11-22）
> 来源：AF-299 已用人工逐条命令证明故障矩阵，AF-292 外审要求「指标能自证」；缺一个可重复、自动判定、失败即非零退出的验收入口。

## 1. 范围

**在范围内：**

- 新增验收器 CLI `bin/visitor-render-acceptance.ts`：场景表 + spawn 真实 smoke + 声明式指标断言 + 汇总表 + 退出码。
- 新增纯函数模块 `bin/lib/render-acceptance-checks.ts`：指标探针、期望比对、smoke JSON 报告提取、smoke 子进程执行。
- 单测 `test/engine-adapters/af302-render-acceptance-checks.spec.ts`。
- Runbook §5.1 补一键自证入口与判读纪律。

**不在范围内：**

- 不改 `bin/visitor-render-smoke.ts` 的故障注入、断言与报告结构（只消费其既有 JSON）。
- 不改告警规则、看板、业务代码、engine-core。
- 不接 Prometheus/Grafana 真实查询，不接 CI（另立 backlog）。

## 2. 验收口径

1. `pnpm exec tsx bin/visitor-render-acceptance.ts` 五条全部 PASS，退出码 0。
2. 任何一条指标不符 → 该场景 FAIL，打印「期望 X=值，实际 Y」，整体退出码 1。
3. `--only double-auth` 只跑一条；未知 id 报错退出非零。
4. 反向验证一条期望改错必须 FAIL，恢复后全绿。
5. 代码零写入 engine-core，不改 smoke 行为。

## 3. 依赖与前置

- 依赖 AF-295 双候选故障注入、AF-299 故障矩阵口径、AF-300 network cause。
- `.env` 需有 MINIMAX_API_KEY / MINIMAX_BASE_URL / MINIMAX_LLM_MODEL / LLM_DOUBAO_API_KEY；故障场景不打真实上游（auth 场景注入无效 key）。
- 场景耗时：4 条秒级，首包超时约 16s，首包后停摆约 30s。

## 4. 回写清单

- 交付记录 `docs/worklog/completed/phase2.5/af302-render-acceptance-2026-11-22.md`。
- 回执 `RC-AF-302-1`；backlog 视情况登记「验收器接 CI」「聚合路径未覆盖」。
