---
taskId: AF-116
contextId: phase2.5-long-session-acceptance
title: AI 代理双盲评分与仲裁链路（可替换真人督导）
type: implementation
status: backlog
baselineRef: 93dd8dbcf62c20d5fa0295fc29fc3f7814aac724
dependsOn: []
priorTasks: [AF-115]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T02:30:00Z
deadline: null
agentRole: executor
scope:
  files:
    - src/auto-practice/metrics/ai-double-blind.ts
    - bin/ai-double-blind.ts
    - test/auto-practice/ai-double-blind.spec.ts
    - docs/worklog/pending/af116-ai-double-blind-panel-task-2026-11-19.md
    - docs/worklog/completed/phase2.5/af116-ai-double-blind-panel-protocol-2026-11-19.md
    - docs/worklog/completed/phase2.5/af116-ai-double-blind-panel-delivery-2026-11-19.md
    - docs/worklog/pending/phase2.5-README.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af116-ai-double-blind-panel-delivery-2026-11-19.md
    kind: report
  - name: 协议
    path: docs/worklog/completed/phase2.5/af116-ai-double-blind-panel-protocol-2026-11-19.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/ai-double-blind.spec.ts
    check: 定向单测全绿
    threshold: exitCode=0
  - command: pnpm typecheck
    check: 类型检查通过
    threshold: exitCode=0
  - command: pnpm lint
    check: lint 0 error / 0 warning
    threshold: exitCode=0
  - command: node scripts/orchestration/cli.mjs validate --sheet docs/worklog/pending/af116-ai-double-blind-panel-task-2026-11-19.md
    check: 任务单 schema 通过
    threshold: exitCode=0
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链与索引投影一致
    threshold: exitCode=0
  - command: git diff --check
    check: 无空白错误与 CR
    threshold: exitCode=0
successCriteria:
  - 提供 AI 代理双盲评分链路：R1 证据优先、R2 整体叙事、独立上下文与独立评分表
  - 对分差 >1 或低置信度的维度触发 R3 AI 仲裁，输出最终评分与仲裁理由
  - 结果明确标记 ai_proxy_candidate / humanSupervision=false / clinicalAcceptanceEligible=false，不得冒充真人督导或质量达标
  - 5 轮与 50 轮均可用：packet 只读匿名逐字稿，不依赖库内会话
  - 真实运行至少 8 个 packet，产出 agreement / final ratings / provenance / limitations
  - 后续接真人时可直接替换 R1/R2/R3 适配器，不重写评分与一致性逻辑
---

## 背景

出口④要求真实督导师双人盲标 + 仲裁，但当前没有真人督导排期。AF-111 已交付 `pack/ingest` 工具与 9 条 long 锚点，缺的是“有人先把两份独立评分和仲裁跑出来”。

本任务用 AI 代理临时补位：两个独立评分员 R1/R2，加一个只处理分歧的仲裁员 R3。它不是真人督导，不能产出“临床质量达标”结论；它的价值是提前暴露评分口径、分歧结构、最差 packet 与可复现证据，等真人到位后替换 R1/R2/R3 即可。

## 目标

- 纯函数模块：评分响应校验、争议维度选择、最终分合并、AI-proxy 报告汇总；
- CLI：读取 AF-111 pack 目录，调用 MiniMax 跑 R1/R2，按分歧调用 R3，输出两份评分、仲裁表、最终分、agreement 与 provenance；
- 运行产物默认写 `--out` 指定目录（不入库），仓库内只保留脱敏报告；
- 文档写清 AI-proxy 边界、可替换点与真实运行结果；
- 不修改 intake 阈值、不接 batch-report/CI 硬门、不写“质量达标”。

## 非目标

- 不替代真人督导，不产生临床验收结论；
- 不把 AI 评分写进 `quality_annotation` 人工表；
- 不新跑练习批次，只读既有冻结逐字稿；
- 不新建标注页面，复用现有 `AnnotationTool` 作为人工入口。
