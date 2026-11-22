---
taskId: AF-324
contextId: phase2.5-orchestration-closed-loop
title: 模型分类器 prompt v2 收紧与分层影子复评
type: implementation
status: backlog
baselineRef: db2e2efdd77feb45dd38007e432fd4cc109a7a1b
dependsOn: [AF-323]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-23T01:50:00.000Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - src/engine-adapters/cognition/
    - test/engine-adapters/
    - scripts/ops/quality/
    - scripts/orchestration/__tests__/
    - docs/worklog/pending/
    - docs/worklog/completed/
    - docs/worklog/records/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af324-classifier-prompt-v2-2026-11-23.md
    kind: report
  - name: 影子复评报告
    path: docs/worklog/completed/phase2.5/af324-classifier-shadow-recheck-2026-11-23.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/model-event-classifier.spec.ts scripts/orchestration/__tests__/af322-classifier-shadow-audit.spec.mjs
    check: 分类器单测与审计统计单测全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 本地类型检查与 CI 同口径
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量测试通过
    threshold: exit=0
  - command: pnpm audit:classifier-shadow -- --rule-only --sample-per-session 10
    check: 规则轨基线可复算
    threshold: exit=0
  - command: pnpm audit:classifier-shadow -- --sample-per-session 10 --limit 70
    check: 真实 shadow 复评完成且无原文输出
    threshold: exit=0
successCriteria:
  - prompt 版本升为 model-event-classifier-v2，并在代码与测试中可核对。
  - 标签判定口径写清 open_probe、sensitive_touch、neutral、holding_present/cold_absent 的互斥与优先级，消除「每个问句都算 open_probe」。
  - sensitive_touch 仅在 user prompt 提供的敏感议题词表被明确触及时输出；词表缺失时禁止输出。
  - 中性轮不再被模型成批改判成具体行为标签；模型轨 neutral 率与规则轨差距压到 10 个百分点以内。
  - 真实 shadow 至少覆盖 7 场 × 10 轮，报告给出 exact、Jaccard、neutral 率、标签分布、降级率与 v1 基线对照。
  - 复评未达标时明确记录结论并保持 shadow，不得切 llm_active。
  - 交付记录含六组机读锚点与临床边界；归档并通过受保护 PR 合入 integrate。
---

# AF-324 · 模型分类器 prompt v2 收紧与分层影子复评

## 1. 背景

AF-323 真实影子审计显示模型轨系统性过判：

- exact 1/13（0.0769），mean Jaccard 0.1859；
- 规则轨 neutral 9/13（0.6923），模型轨 neutral 仅 1/13（0.0769）；
- `sensitive_touch` 8/13、`open_probe` 9/13，规则轨均为 0；
- 1 轮在 3 次 3s 超时后降级。

生产仍走规则轨，模型轨只 shadow，因此这不是线上故障。但模型轨标签不可信，任何后续 `llm_active`、触发式审议或自动评测都不能建立在它上面。本单只做 prompt 收紧与复评，不切生产模式。

## 2. 范围

### 2.1 prompt 口径

- 版本升为 `model-event-classifier-v2`。
- `open_probe` 只认「明确邀请来访者展开新内容」的问句；封闭式提问、澄清、复核事实、心理教育后的提问一律不算。
- `sensitive_touch` 只在 user prompt 的敏感议题词表被明确命中时输出；词表缺失时禁止输出。
- `neutral` 是「本轮没有其他行为标签」的兜底；不要为了「显得细」硬加标签。
- `holding_present` / `cold_absent` 只描述在场状态，不与 `neutral` 同时输出；普通回应不得判为在场状态事件。
- 多标签只在两个行为独立成立时输出；同一句不能既算 empathy 又算 open_probe，除非确实同时反映感受并邀请展开。

### 2.2 审计复评

- 复用 AF-323 审计 CLI，不改统计口径。
- 规则轨基线：`--rule-only --sample-per-session 10`。
- 真实 shadow：`--sample-per-session 10 --limit 70`，至少覆盖 7 场 × 10 轮。
- 报告含 v1 / v2 对照、标签分布、分场次、降级与限制。

## 3. 非目标

- 不切 `llm_active`，不改生产分类模式。
- 不改规则轨词典与内核 delta。
- 不改 `src/engine-core/**`。
- 不引入人工金标准，不宣称临床有效性。

## 4. 验收

- 定向单测、typecheck、lint、全量测试全绿。
- 真实 shadow 报告给出 v1 / v2 同口径对照；未达标时明确写「不切换」。
- 交付记录六组机读锚点齐全，`git diff --stat HEAD -- src/engine-core` 为空。
