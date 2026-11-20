---
taskId: AF-073
contextId: phase2.5-exit-condition-4
title: Phase2.5 出口条件④正式判定与 WP-K 归档快照四态收口
type: verification
status: backlog
baselineRef: cc9aad18d30ffaeaf1370c361fa9593309199d6f
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T01:55:00.000Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - bin/batch-report.ts
    - test/auto-practice/
    - data/batch-reports/
    - docs/worklog/pending/
    - docs/worklog/pending/phase2.5-README.md
    - docs/worklog/pending/archive/
    - docs/worklog/completed/phase2.5/
    - docs/security/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af073-phase25-exit4-formal-verdict-2026-11-18.md
    kind: report
gates:
  - command: node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit
    check: build 类型检查 0 error
    threshold: 0 error
  - command: node node_modules/eslint/bin/eslint.js "{src,test,bin}/**/*.ts"
    check: 定向 lint 0 error 0 warning
    threshold: 0 error 0 warning
  - command: node node_modules/vitest/vitest.mjs run test/auto-practice/af073-batch-report-cli.spec.ts
    check: WP-K CLI 归档快照与缺批退出码定向单测全绿
    threshold: 0 failed
  - command: node node_modules/vitest/vitest.mjs run test/engine-core/boundary.spec.ts
    check: engine-core boundary 12 绿
    threshold: 12 passed
  - command: node node_modules/tsx/dist/cli.mjs bin/batch-report.ts --batch g3ONzlqSGMVJqkFMF9Lwh --format json --out <TEMP>
    check: 库内无该批时 exit 2 且不生成空报告
    threshold: exit 2
successCriteria:
  - 以归档 96 场快照为基准、当前 8 场批次为候选，由 WP-K CLI 正式产出四态结论，禁止手工拼结论或伪造库内数据
  - 旧 96 场批次库内无行时 CLI 必须 exit 2，不得 exit 0 并生成空报告
  - 出口条件④正式结论必须写明“未通过 / 核心指标不可判”，不得写成“质量达标”
  - 回写 phase2.5-README §3.2 与 §3.2.1，保留旧 96 场仅作历史证据、当前 8 场 intake FAIL 的事实
  - 归档 AF-067 / AF-068 的 relay 回复；核对 GHSA-fc5q-39xc-vjpf 风险接受复核日期，不改变已接受结论
  - 不新跑 LLM 批次、不改 business src、engine-core、数据库、migration、seed 与 .env
---

# AF-073 · Phase2.5 出口条件④正式判定与 WP-K 归档快照四态收口

## 背景

2026-11-17 环境迁移后，旧 96 场批次 `g3ONzlqSGMVJqkFMF9Lwh` 已不在当前 `ap_practice_sessions`，不能直接重建；当前唯一批次 `uJHgP8uQGeM8Z6HbZY7M5` 为 8 场 / 94 轮且 intake 全局 FAIL。WP-K CLI 目前对“库内无该批”仍 exit 0 并生成空 `index.md`，与契约 exit 2 不符；同时 CLI 没有读取归档快照做正式四态比较的入口，导致出口条件④只能停留在“不可判”的口头结论。

## 目标

1. 修 `bin/batch-report.ts`：请求批次在库内缺失时明确报错并 exit 2，不写空报告。
2. 增 `--baseline-snapshot <path>`：读取并校验归档 `BatchMetricsV1` JSON，作为比较基准；候选仍从库内批次构建，正式调用 `evaluateRegression` 输出 improved / neutral / regressed / incomparable。
3. 用归档 `data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.json` 与当前 `uJHgP8uQGeM8Z6HbZY7M5` 实跑，产出正式四态；预期为 `incomparable`（验收判据、角色集合与指纹段不同）。
4. 以正式四态 + 当前 8 场 intake FAIL + 无真实督导 `dataset.json` 为依据，把出口④结论回写 §3.2：**未通过 / 核心指标不可判**。
5. 归档 AF-067 / AF-068 relay 回复；复核 GHSA 风险接受文档，不改结论。

## 非目标

- 不新跑 LLM 批次，不重建 96 场库内数据，不伪造 `ap_practice_sessions` 行。
- 不改 `src/engine-core`、业务 service、数据库 schema / migration / seed、`.env`。
- 不把 `incomparable` 解释成“达标”；没有真实督导标注时，80% 准确率仍不可评测。
