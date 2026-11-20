---
taskId: AF-204
contextId: phase2.5-orchestration-closed-loop
title: 来访者真人度 R0/R1：度量口径纠偏、输出闸门、分层 prompt 与话轮形态
type: implementation
status: backlog
baselineRef: f8bb141d4015cc8537c40afcc0d2a7dd268a3b37
dependsOn: []
priorTasks: [AF-203]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T21:41:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/auto-practice/metrics/
    - src/shared/text/output-integrity.ts
    - src/shared/realism/
    - src/engine-adapters/rendering/
    - test/auto-practice/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af204-visitor-realism-r0-r1-2026-11-20.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/metrics/disfluency-analyzer.spec.ts test/auto-practice/af204-output-integrity-shape.spec.ts test/auto-practice/af204-realism.spec.ts
    check: 定向回归全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 后端类型检查 0 error
    threshold: exit=0
  - command: pnpm exec eslint --no-cache "{src,test}/**/*.ts"
    check: lint 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量测试 0 failed
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty
successCriteria:
  - repair 口径不再把“是不是”和普通否定误计为自我修正；新增或保留可审计的严格改口计数。
  - 输出闸门能拦截 JSON 摘要、结构化输出、未闭合推理与无标签英文推理残片，并保持安全兜底台词场景中立。
  - 新增真人度 profile 纯函数：off/audit 模式 prompt 与现状逐字一致；active 模式按角色、状态、场景生成配额指令。
  - 新增确定性话轮形态选择器，覆盖 7 角色 × 3 场景 × 关键状态组合，不新增 LLM 调用。
  - prompt 层明确安全/场景/角色声音/话轮形态/不流利配额的优先级，消除 trauma 换话题与 intimate 问回咨询师的硬规则冲突。
  - 定向测试、类型检查、lint、全量测试全绿；engine-core 零 diff；交付记录与回执齐全。
---

# AF-204 · 来访者真人度 R0/R1

## 目标

把“真人度”从单一不流利指标扩展为可审计的六维体系中的前两批能力：

- R0：修正 repair 度量假高，补齐输出完整性闸门（JSON 摘要、结构化输出、未闭合推理、英文残片）。
- R1：新增真人度 profile、分层 prompt 与确定性话轮形态选择器；默认 off/audit，不改变现有行为。

## 并行分工

- MiniMax Code：R0 度量口径与输出闸门，只改 `disfluency-lexicon.ts`、`disfluency-analyzer.ts`、`output-integrity.ts` 及对应新增测试。
- 主控：R1 真人度 profile、话轮形态选择器、prompt 分层接线与测试；不碰 MiniMax 负责的 R0 文件。
- 主控统一执行最终闸门、提交、PR 与回执，MiniMax 不执行 git commit/push/branch。

## 硬约束

- 不碰 `src/engine-core`。
- 不新增 LLM 调用；不随机插入文本。
- off/audit 模式 prompt 逐字不变。
- 不把心理原文写入任何新报告、日志或快照。
- 历史快照不回溯、不重算。
