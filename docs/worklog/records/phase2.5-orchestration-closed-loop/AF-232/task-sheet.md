---
taskId: AF-232
contextId: phase2.5-orchestration-closed-loop
title: R6-D4 来访者模拟器 Seed Character 2×2 影子对照
type: implementation
status: backlog
baselineRef: 1b4762a133a1794f7cd31a43580da9ce2f465f0e
dependsOn: [AF-227]
priorTasks: [AF-227, AF-229, AF-231]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T02:20:00+08:00
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
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af232-seed-character-visitor-shadow-2026-11-22.md
    kind: report
  - name: 2×2 影子对照报告
    path: data/phase25-exit/af232-seed-character-visitor/report.json
    kind: dataset
  - name: 影子对照摘要
    path: data/phase25-exit/af232-seed-character-visitor/summary.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/af232-visitor-shadow.spec.ts
    check: 影子对照纯函数与 prompt 约束用例全绿
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
  - 建立离线 2×2 影子对照 CLI：MiniMax-M3 + 现行 visitor prompt；Seed Character + 现行 visitor prompt；Seed Character + Seed 专用 prompt；MiniMax-M3 + Seed 专用 prompt。
  - 12 场会话由 4 个官方 persona × L1/L2/L3 三档组成，咨询师脚本固定 12 轮，覆盖开场、共情、封闭提问、过早建议、沉默、面质与收束；四臂只替换来访者生成模型与 prompt，不替换咨询师脚本。
  - Seed 专用 prompt 强制来访者身份：不替咨询师做决定、不给建议、不总结、不推进剧情、不主动开启新话题、不主动暴露核心创伤、短句为主、允许沉默/回避/答非所问；输出只含来访者台词与合法语义标记。
  - 每轮生成记录 provider、model、promptVariant、latencyMs、promptTokens、completionTokens、reasoningTokens、finishReason、文本长度与语义标记合法性；日志与报告不输出台词原文。
  - 客观分析覆盖 AI 身份暴露、给建议、替咨询师总结、剧情推进/旁白、人设硬冲突、超长回复率、提问频率、L3 短答/回避比例、首 token P50/P95、截断率、非法语义标记率。
  - 生成会话按 debug-session 兼容形状落盘，使用既有盲评包构造函数去身份化；由 MiniMax-M3.1-Flash 与豆包 Seed 2.1 Lite 各一名评分员盲评，评分员不接触生成模型身份。
  - 预登记硬门槛：AI 暴露 0、给建议/总结/剧情推进 0、人设硬冲突 0、L3 短答/回避不低于 baseline 80%、超长回复率低于 5%、首 token P95（关闭 thinking）低于 1.5s、非法语义标记率低于 1%。
  - 预登记软门槛：五维真人度均值不低于 baseline 0.2 分、跨模型 κ 不低于 0.4、总体绝对差不超过 0.3、长度标准差不低于 0.5、4 分占比低于 70%、过度配合指数不高于 baseline。
  - 只做影子验证与建议，不直接切生产、不改 visitor 运行时、不改全局 LLM_DOUBAO_MODEL、不改评分阈值/证据校验、不碰 engine-core/admin-dashboard/Flutter。
  - 定向测试、lint、typecheck、CI 同款 tsc、全量测试全绿；交付记录、回执、归档与任务分支提交齐全。
---

# AF-232 · R6-D4 来访者模拟器 Seed Character 2×2 影子对照

## 背景

用户确认 `doubao-seed-character-260628` 的定位是**来访者模拟器**，不是主评分员。当前生产来访者链路是 `src/agent/visitor` → `src/agent/llm`，模型基址与密钥硬绑 MiniMax，不能只靠改 env 切换。为避免把“角色扮演更像人”误当成“临床模拟更真实”，本任务先做离线影子对照，不直接切生产。

## 范围

1. 新增离线影子对照 CLI 与纯函数分析，生成 12 场固定脚本会话，四臂对照。
2. 新增 Seed 专用来访者 prompt（只用于影子实验，不进生产 prompt）。
3. 用既有盲评包与两名评分员做去身份盲评，产出客观指标与预登记门槛判定。
4. 产出交付记录、回执与任务分支提交；不接生产、不改全局模型配置。

## 非目标

- 不做真人督导师双标，不声称临床达标。
- 不改 `src/agent/visitor/**`、`src/agent/llm/**` 生产链路；生产接入另开任务。
- 不改 `src/engine-core/**`、评分阈值、证据校验、admin-dashboard、Flutter。
- 不扩到 24/48/96 场；先以 12 场验证方向。
