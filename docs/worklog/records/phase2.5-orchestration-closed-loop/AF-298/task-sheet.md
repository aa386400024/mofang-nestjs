---
taskId: AF-298
contextId: phase2.5-orchestration-closed-loop
title: 渲染比率三口径自证与轮次恒等式告警
type: fix
status: backlog
baselineRef: 54d71994d2d10763c74c3b1dc58ec7dbe04d09de
dependsOn: []
priorTasks: [AF-292, AF-296, AF-297]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3]
createdAt: "2026-11-22T18:31:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - docker/prometheus/alerts.yml
    - docker/grafana/dashboards/mofang-overview.json
    - test/config/af283-render-alerting.spec.ts
    - docs/runbooks/render-telemetry-alerting.md
    - docs/worklog/completed/phase2.5/af298-render-ratio-three-views-2026-11-22.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-298/
  modules: []
  interfaces: []
artifacts:
  - name: AF-298 交付记录
    path: docs/worklog/completed/phase2.5/af298-render-ratio-three-views-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/config/af283-render-alerting.spec.ts
    check: 告警/看板/Runbook 三方口径守卫
    threshold: exit=0
  - command: pnpm typecheck
    check: TypeScript 全量类型检查
    threshold: exit=0
successCriteria:
  - provider 降级率分母排除 cancelled 与 guard（rounds outcome=~"success|degrade|exhausted"）。
  - 看板同面板给出 provider 降级率、体验失败率、取消占比三条曲线，禁止两条曲线混用同名图例。
  - 新增 rounds/degraded 恒等式告警，degraded_total > 对应 rounds 汇总时触发。
  - Runbook 写清三口径用途、barge-in 稀释效应、恒等式对账查询与告警滞后。
  - 静态守卫逐面板校验新分母与恒等式规则；定向测试、typecheck 全绿。
---

# AF-298 · 渲染比率三口径自证与轮次恒等式告警（fix / executor）

> 状态：📋 待执行（2026-11-22）
> 来源：AF-292 外审 P1（A2 三条口径）与 A4（恒等式守卫）。

## 1. 范围

**在范围内：**

- `alerts.yml`：provider 降级率分母改为 `rounds{outcome=~"success|degrade|exhausted"}`；新增 `VisitorRenderRoundInvariantMismatch`。
- Grafana id 10：同面板三条曲线（provider 降级率、体验失败率、取消占比），图例显式区分。
- `af283-render-alerting.spec.ts`：逐面板断言三条 expr；断言恒等式规则存在且用 `unless`。
- Runbook：三口径定义、barge-in 稀释、体验失败率用途、恒等式对账、告警滞后。
- 全量闸门与交付记录。

**不在范围内：**

- 不改 `rounds_total` 的 `outcome` 标签名（A7 涉及全链路兼容，另单评估）。
- 不新增指标、不改业务代码、不改告警阈值（provider 仍 3%）。
- 不给体验失败率单独设告警阈值（缺灰度基线，先上面板并登记 backlog）。

## 2. 验收口径

- provider 降级率 expr 必须同时含 `cause!="guard"` 与 `outcome=~"success|degrade|exhausted"`。
- 体验失败率 expr 分子为全量 `degraded_total`，分母为 `rounds{outcome!="cancelled"}`。
- 取消占比 = `cancelled_total / rounds_total`（保持“占全部交互”的口径，不采用外审的 non-cancelled 分母，避免比例可超过 100%）。
- 恒等式告警：`degraded_total` 的 10m 增量 `unless` `rounds{outcome=~"degrade|guard|exhausted"}` 的 10m 增量。
- 静态守卫对 id 10 的每个 target 逐条校验，不允许再用 attempts 作分母。
- `pnpm exec vitest run test/config/af283-render-alerting.spec.ts` 全绿；`pnpm typecheck` exit 0。

## 3. 红线

- 不改阈值；不新增告警噪音源；不碰 engine-core 与业务代码。
- 看板/告警/ Runbook 三处必须同口径，禁止只改一处。
- 状态面只经 CLI。
