---
taskId: AF-128
contextId: phase2.5-ai-proxy-acceptance
title: 可见输出推理标签泄漏的命名空间与孤立闭合清洗
type: fix
status: backlog
baselineRef: edcae81f46115cfed4cbe374045eb1b1b5dd44ec
dependsOn: [AF-127]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T11:14:35+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/llm/reasoning-text.ts
    - test/shared/af106-reasoning-text.spec.ts
    - docs/worklog/pending/af128-visible-output-think-leak-task-2026-11-19.md
    - docs/worklog/completed/phase2.5/af128-visible-output-think-leak-2026-11-19.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af128-visible-output-think-leak-2026-11-19.md
    kind: report
gates:
  - command: pnpm exec vitest run test/shared/af106-reasoning-text.spec.ts
    check: 推理标签清洗定向单测全绿
    threshold: exit 0；7 tests passed
  - command: pnpm exec tsc --noEmit
    check: 类型检查 0 error
    threshold: exit 0；0 error
  - command: pnpm lint
    check: lint 0 error 0 warning
    threshold: exit 0；0 error / 0 warning
successCriteria:
  - 清洗标准 think 标签同时覆盖命名空间 mm think 与孤立闭合标签
  - 流式安全前缀不泄漏半截命名空间标签
  - 原有 AF-106 契约与测试保持通过
  - 不调用 LLM、不新跑练习批次、不改咨询师 prompt 与阈值
---

# AF-128 · 可见输出推理标签泄漏的命名空间与孤立闭合清洗

## 背景

AF-127 的 16 个冻结 long packet 中，`packet-14` 第 29 轮咨询师台词末尾出现 `</mm:think>`。AF-106 只清洗了标准 `<think>` / `</think>`，没有覆盖带命名空间的 `mm:think` 与孤立闭合标签，导致推理协议残留进入可见台词。

## 目标

把 `src/shared/llm/reasoning-text.ts` 的清洗口径扩展到：

1. 闭合块 `<mm:think>...</mm:think>`；
2. 未闭合 `<mm:think>...` 尾块；
3. 孤立 `</mm:think>`（没有开标签）；
4. 流式 `safeVisiblePrefix` 对半截命名空间标签的扣留。

## 边界

- 只改共享清洗函数与其定向单测；不改咨询师 prompt、不改 engine-core、不改 ai-proxy 阈值。
- 不调用 LLM、不新跑练习批次、不写 DB。
- 输出仍是 `candidate` 口径；本单只修泄漏，不承担临床质量结论。
