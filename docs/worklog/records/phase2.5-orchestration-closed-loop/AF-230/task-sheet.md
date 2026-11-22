---
taskId: AF-230
contextId: phase2.5-orchestration-closed-loop
title: R6-D3 Lite 原生评分 prompt V1 与 12 packet 开发集
type: implementation
status: backlog
baselineRef: 1b4762a133a1794f7cd31a43580da9ce2f465f0e
dependsOn: [AF-229]
priorTasks: [AF-229]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-21T23:50:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - bin/
    - test/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: Lite prompt V1 实现记录
    path: docs/worklog/completed/phase2.5/af230-lite-prompt-v1-2026-11-21.md
    kind: report
  - name: 12 packet 基线报告
    path: data/phase25-exit/af229-lite-dev-12/baseline/report.json
    kind: dataset
  - name: 12 packet Lite V1 报告
    path: data/phase25-exit/af229-lite-dev-12/v1/report.json
    kind: dataset
  - name: V1 对照结果
    path: data/phase25-exit/af229-lite-dev-12/v1-vs-baseline.json
    kind: dataset
gates:
  - command: pnpm exec vitest run test/auto-practice/af229-lite-prompt.spec.ts
    check: Lite prompt 契约用例全绿
    threshold: exit=0
  - command: pnpm exec vitest run test/auto-practice/af229-calibration-analysis.spec.ts
    check: promptVariant/端点透传用例全绿
    threshold: exit=0
  - command: pnpm lint
    check: lint 0 error / 0 warning
    threshold: exit=0
  - command: pnpm typecheck
    check: typecheck 0 error
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo
    check: CI 同款全量类型检查 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量测试通过
    threshold: exit=0
successCriteria:
  - 新增 Lite 专用评分 prompt 模块，与既有共享 prompt 并存，输出仍走 AF-214 行协议，可被现有解析器直接解析。
  - 运行时与跨模型 CLI 支持 `--doubao-prompt shared|lite-v1`，报告写入 prompt 变体，不混淆两条轨道。
  - 12 个开发 packet 必须与 AF-229 的 24 评测 + 24 锚点交集为 0，三场景各 4 个，清单与场景/轮次/字符数落盘。
  - 在同一 12 packet 上跑共享 prompt 基线与 Lite V1 两轮，记录 parse、跨模型 κ、绝对差、exact、within±1、模型内 κ、分数分布、reasoning token 与截断。
  - V1 未达预登记阈值时，必须给出 V2 的具体修法（5/4 门槛、全 4 默认、overall 规则等）与不继续跑 24/48 的理由；不得把 V1 写成达标。
  - 不跑 48 全量，不扩 96/360 线上样本，不改 R6-D 阈值，不改 evidence 校验，不合并模型分数。
  - 报告保持 ai_proxy_candidate，humanSupervision=false，clinicalAcceptanceEligible=false；真人双标仍待上线阶段补做。
  - 定向测试、lint、typecheck、CI 同款 tsc、全量测试全绿；交付记录、机读回执、归档与受保护 PR 齐全。
---

# AF-230 · R6-D3 Lite 原生评分 prompt V1 与 12 packet 开发集

## 背景

AF-229 的 R6-D2 把 Pro 排除后，Lite 在 48 packet 上仍未达跨模型 κ/绝对差门槛。用户判断 Lite 与 MiniMax-M3.1-Flash 不是同一套 prompt 调出来的，直接拿共享 prompt 比较不公平。本单按双轨制 A 执行：每个模型自己的 prompt、自己的稳定性门槛；跨模型一致性只作第二层检查；不做 Lite→M3.1 仿射映射。

## 范围

1. 新增 `bin/realism-rater-lite-prompt.ts`：五维可观察行为清单、五步流程、专项检查、反默认分规则、证据规则、行协议输出契约。
2. `bin/realism-rater-runtime.ts` 增加 `promptVariant`，只允许豆包走 `lite-v1`；`bin/visitor-realism-cross-model.ts` 增加 `--doubao-prompt` 并在报告写 prompt 变体。
3. 12 个开发 packet 来自 48 池之外的同一候选池，三场景各 4 个；跑共享 prompt 与 Lite V1 两轮对照。
4. 只有 12 packet 开发集，不跑 24 评测、不跑 48 全量；V1 失败时给 V2 方案，不直接扩样本。

## 边界

- 不改 `src/**`、engine-core、admin-dashboard、Flutter、编排脚本。
- 不改既有 `buildRealismRaterPrompt` 与 `REALISM_ANCHORS`；Lite prompt 是并存的新模块。
- 不把 AI 预评审写成临床达标；不修改 R6-D 阈值；不合并模型分数。
