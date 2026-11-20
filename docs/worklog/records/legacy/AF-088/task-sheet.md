---
taskId: AF-088
contextId: phase2.5-exit-condition-3-4-5
title: Phase2.5 出口条件③④⑤可执行项全量收口（审议成本 / 督导评测 / 1000 场数据）
type: implementation
status: backlog
baselineRef: 0fe23b0f7f535a1bc639cd377a76fc42d66c1ef9
dependsOn: []
priorTasks: [AF-087]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T08:05:00.000Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/ops/quality/
    - data/phase25-exit/
    - data/eval-datasets/
    - data/eval-reports/
    - data/batch-reports/
    - docs/team/agent-orchestration/agent-cards/
    - docs/worklog/pending/
    - docs/worklog/pending/archive/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af088-phase25-exit345-evidence-2026-11-18.md
    kind: report
  - name: 取证 JSON
    path: data/phase25-exit/af088-exit345-evidence-2026-11-18.json
    kind: dataset
gates:
  - command: node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit
    check: build 类型检查 0 error
    threshold: 0 error
  - command: pnpm lint
    check: lint 0 error（使用缓存）
    threshold: 0 error
  - command: node node_modules/vitest/vitest.mjs run test/engine-core/boundary.spec.ts
    check: engine-core boundary 全绿
    threshold: 0 failed
successCriteria:
  - 出口③给出真实审议调用与单场 50 分钟成本证据并判定是否 ≤1 元
  - 出口④给出督导评测链路的真实证据与可判定性结论，不以合成数据冒充验收
  - 出口⑤给出库内有效场次累计证据与 1000+ 场达成情况
  - 所有结论写入 README §3.2 与交付记录
  - 不伪造数据、不手改状态面、不跳过钩子
---

# AF-088 · Phase2.5 出口条件③④⑤可执行项全量收口

## 背景

AF-086 已完成出口②真实双跑与出口④规则层判读，但出口③（单场 50 分钟审议成本 ≤1 元）、出口④（督导建议准确率 ≥80%）、出口⑤（1000+ 场自动对练数据）仍无正式证据。当前库内仅 8 场 / 94 轮，`ENGINE_DELIBERATION_ENABLED` 未启用，`data/eval-datasets/` 仅有合成种子集。

用户已明确：按真实环境执行，不考虑 LLM 成本，能做的全部做掉；仍须遵守 agent-collaboration-framework 的登记 / 领单 / 任务分支 / 定向闸门 / 回执 / PR / 合并 / 归档闭环。

## 目标

1. **出口③**：以真实服务进程开启 `ENGINE_DELIBERATION_ENABLED=true` + `ENGINE_DELIBERATION_EFFECTIVE_MODE=shadow`，跑非 exam 场景（`full_simulation`）的 50 轮长会；用 `/admin/api/deliberation/stats` 前后差值与 `deliberation_trace` 取证真实审议调用次数、token、耗时，按仓库同一定价表折算单场成本，判定是否 ≤1 元。
2. **出口④**：运行仓库既有离线评测链路 `scripts/eval-runner.ts`，记录 `synthetic-supervisor-v1` 的触发质量与建议质量；同时明确该数据集 `synthetic=true`、不能作为验收结论。若仓库内无真实督导标注数据集，正式结论必须是「不可判定 / 未通过」，不得用合成分数冒充 80%。
3. **出口⑤**：通过生产入口 `POST /admin/api/auto-practice/batch` 投递 1000 场 12 轮批次（非 exam，避免与出口②考核口径混淆），轮询到完成；统计库内有效场次、轮次、批次状态分布、失败原因，给出累计场次是否达到 1000+ 的证据。
4. 回写 `docs/worklog/pending/phase2.5-README.md` §3.2 出口条件表与 §3.3 下一步；交付记录落 `docs/worklog/completed/phase2.5/`；证据 JSON 落 `data/phase25-exit/`。
5. 全程走编排 CLI：登记 → promote → run-once → 任务分支 → 实现 → 定向闸门 → 回执 → 归档 → PR → squash 合并。

## 非目标

- 不伪造督导标注，不把 LLM 当裁判生成“真值”。
- 不手改 `task-state-index.json` / `state/journal.jsonl` / `improvement-log.json`。
- 不跳过 Husky、不使用 `--no-verify`、不关闭分支保护。
- 不修改 `src/engine-core` 与业务语义；确需新增取证脚本时只动 `scripts/ops/quality/`。

## 风险与边界

- 1000 场 12 轮真实批次耗时可能超过单次会话窗口：允许后台投递 + 定时轮询，但必须给出真实完成数与未完成原因，不得提前宣称达标。
- 真实督导语料不在仓库内：出口④若无法取得真实标注，结论只能是「不可判定」，这是红线而非失败。
- 服务进程只在本机临时端口运行，结束后停止；不修改 `.env` 持久配置。
