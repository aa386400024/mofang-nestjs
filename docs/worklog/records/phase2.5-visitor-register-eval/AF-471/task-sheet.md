---
taskId: AF-471
contextId: phase2.5-visitor-register-eval
title: 归因 AF-466 active 语域块 p95 延迟增量并估算重复运行方差
type: investigation
status: backlog
baselineRef: 3d0b4399ef3f7f82b815d7a9ff2f25c8f38fdc53
dependsOn: []
priorTasks: [AF-466, AF-470]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-24T22:00:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - scripts/eval/visitor-register-stability/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-visitor-register-eval/AF-471/
  modules:
    - visitor-register-eval
  interfaces: []
artifacts:
  - name: 延迟归因与重复方差报告
    path: docs/worklog/completed/phase2.5/af471-register-latency-attribution-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/eval/visitor-register-stability/__tests__/latency-attribution.spec.mjs
    check: 延迟归因纯函数单测全绿
    threshold: 0 failed
  - command: pnpm lint
    check: lint 通过
    threshold: 0 error
  - command: pnpm typecheck
    check: 类型检查通过
    threshold: 0 error
  - command: node --check scripts/eval/visitor-register-stability/analyze-latency.mjs
    check: 归因脚本语法通过
    threshold: exit 0
successCriteria:
  - 只使用 af466-2026-11-24-10roles 现有产物做逐轮归因，不新增模型调用、不改生产 prompt。
  - 输出 base/active 的 p50/p95、慢轮集中度、角色/模式/轮次分层，以及 prompt tokens 与延迟的关系。
  - 明确回答 p95 中位 +32.06% 是否可由 prompt 中位 +12.85% 解释，并给出主因假设与证据强度。
  - 若现有数据不足以定因，给出最小定向实验矩阵：角色、变体、轮次、指标、判定阈值；不直接改生产实现。
  - 给出重复运行方差的初步估计，覆盖 AF466-B3，并说明需要几场重复才能区分运行噪声。
  - 不修改 src/engine-core，不放宽 15% 成本门，不改 noHarm 阈值。
  - 报告只保留聚合指标，不落任何来访者原文或心理内容。
---

## 1. 背景

AF-466 已完成 10 角色 20 场 600 轮重跑，方向、刻板、跨轮稳定、BDI 均通过，但 cost 门的 p95 延迟中位增量 `+32.06%` 未过预注册阈值 `<=15%`，最终 `gatePass=false`。prompt 中位增量只有 `+12.85%`，两者差距明显，不能只用“多了一段语域块”解释。

AF-466 已把后续拆为四项 backlog，其中本任务承接 `AF466-B2`（active p95 延迟归因）与 `AF466-B3`（每角色第二场重复测方差）。本任务只做诊断，不做生产修复，避免在未定因前改 prompt 或放宽门槛。

## 2. 目标

用现有 `data/eval-reports/visitor-register-stability/af466-2026-11-24-10roles/` 产物，回答三个问题：

1. p95 增量是“少数慢轮拉高尾部”，还是整体分布右移；
2. 慢轮是否与语域块长度、块位置、首包延迟、角色、轮次位置相关；
3. 现有 600 轮数据的重复运行方差有多大，当前 `+32.06%` 是否可能由单次运行波动主导。

## 3. 实现口径

- 优先只读分析既有 `sessions/<role>/<mode>.json`、`metrics.json`、`manifest.json` 与运行日志，不发起新的 LLM 调用。
- 若现有产物缺少逐轮延迟/首包/token 字段，先确认缺口，再给最小定向实验矩阵；不在本任务里直接改生产渲染层。
- 新增分析脚本放 `scripts/eval/visitor-register-stability/`，纯函数抽到可单测模块；脚本只读评测产物，不写业务库、不读心理原文到普通日志。
- 所有报告数字必须能从产物复算；无法复算的结论标为假设，不写成事实。
- 不修改 `src/engine-core`、不改生产 prompt、不放宽 `cost` 与 `noHarm` 门槛。

## 4. 非目标

- 不做生产修复、不调整语域块位置/长度。
- 不新增 10 角色全量重跑；是否跑定向实验由归因结论决定，并另行登记。
- 不做人评，不改变 AF-466 的 `direction_consistent_but_limited` 结论。
- 不处理 AF-427 本地语料测试债（AF466-B4）。

## 5. 交付

- 归因脚本 + 单测；
- `docs/worklog/completed/phase2.5/af471-register-latency-attribution-2026-11-24.md`：结论、证据、主因判断、重复方差估计、最小实验矩阵、限制；
- 机读回执；
- 在报告中回写 AF466-B2/B3 状态与后续建议。
