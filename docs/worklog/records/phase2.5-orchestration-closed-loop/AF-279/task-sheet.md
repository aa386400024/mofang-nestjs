---
taskId: AF-279
contextId: phase2.5-orchestration-closed-loop
title: AF-278 渲染遥测只读评审（生产可用性：基数/回调/竞态/语义/生命周期/隐私/测试缺口）
type: review
status: backlog
baselineRef: 39b4f88d8b8f64f2a1507f30fba01367a0abd59a
dependsOn: [AF-278]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T14:05:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - docs/worklog/inbox/af279-af278-render-telemetry-review-2026-11-22.md
    - docs/worklog/pending/relay-response-AF-278-REVIEW-20261122-1400.md
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 评审报告
    path: docs/worklog/pending/relay-response-AF-278-REVIEW-20261122-1400.md
    kind: report
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af279-af278-render-telemetry-review-2026-11-22.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 类型闭合（只读评审未改 src）
    threshold: exit=0
  - command: pnpm exec vitest run test/engine-adapters/af278-render-telemetry.spec.ts test/shared/infra/metrics/render-telemetry-metrics.spec.ts
    check: 复跑被评审的两个定向 spec
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: 输出为空
  - command: git diff --stat HEAD -- src/ test/
    check: 只读评审未改 src/ 与 test/
    threshold: 输出为空
---
# AF-279 · AF-278 渲染遥测只读评审

## 背景

AF-278 在 `task/AF-278-render-telemetry-metrics` 实现了渲染链路六类 Prometheus 指标（原提交 cf9cac4a，squash 后为 af4c370c），本地 4313 例全绿，PR #123 待 CI。

本单按大炮指派做**只读评审**：评估这套遥测的生产可用性，不改代码、不提交、不切分支。

## 目标

1. 六类指标的基数与标签稳定性。
2. 回调重复/漏记（重试、切备、锁定后中断、预检 block）。
3. first-delta 与 idle guard 的竞态。
4. degraded 与 attempts 语义是否自洽。
5. ENGINE_RENDER_PORT 注入的生命周期。
6. 隐私（标签是否可能带内容）。
7. 测试缺口。

## 非目标

- 不修改 `src/`、`test/`、`bin/`、`admin-dashboard/`。
- 不提交、不推送、不切分支。
- 不改阈值、不改协议。

## 方法

- 逐行读 cf9cac4a（squash 后 af4c370c）的 11 个文件 diff。
- 用 `pnpm exec tsx -`（stdin 内联，不落盘任何文件）构造真实 `LlmRenderAdapter` + 记录型 `RenderTelemetryPort`，实测 barge-in / 候选耗尽 / 单候选限流 / 锁定后 401 / 安全拦截 / 纯推理流 / 缺模型名 七条路径的回调序列。
- `pnpm typecheck` 与两个定向 spec 复跑。

## 验收

- 评审报告写入 `docs/worklog/pending/relay-response-AF-278-REVIEW-20261122-1400.md`，按 P0/P1/P2 列问题，每条给文件:行与影响，最后给「可上生产 / 需修后上」结论。
- `pnpm typecheck` exit 0；两个定向 spec 全绿。
- `git diff --stat HEAD -- src/engine-core` 与 `-- src/ test/` 均为空。
- 交付记录含六组机读字段标记。
