---
taskId: AF-227
contextId: phase2.5-orchestration-closed-loop
title: 来访者真人度 R6-D：MiniMax × 豆包 Seed 2.1 Pro 跨模型评分校验
type: implementation
status: backlog
baselineRef: 5cdaef6f9ab1d4102f9758b7b142195defed9707
dependsOn: [AF-226]
priorTasks: [AF-207, AF-208, AF-209, AF-213, AF-214, AF-216, AF-225, AF-226]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-21T16:05:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/llm/
    - bin/
    - test/llm/
    - test/auto-practice/
    - .env.example
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af227-realism-r6d-cross-model-2026-11-21.md
    kind: report
  - name: 跨模型复评报告
    path: data/phase25-exit/af227-realism-cross-model/report.json
    kind: report
  - name: 跨模型复评摘要
    path: data/phase25-exit/af227-realism-cross-model/summary.md
    kind: report
gates:
  - command: pnpm exec vitest run test/llm/af227-doubao-rater.spec.ts test/llm/minimax-provider.spec.ts test/auto-practice/af227-cross-model-analysis.spec.ts test/auto-practice/af227-rater-runtime.spec.ts
    check: 豆包模型配置、评分运行时与跨模型统计定向用例全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 后端类型检查 0 error
    threshold: exit=0
  - command: pnpm lint
    check: lint 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量测试 0 failed
    threshold: exit=0
  - command: pnpm env:doctor --keys MINIMAX_API_KEY,LLM_DOUBAO_API_KEY,LLM_DOUBAO_MODEL
    check: 评分双模型的关键键存在且非空
    threshold: PASS
  - command: node --env-file=.env --import tsx bin/visitor-realism-cross-model.ts --source data/debug-sessions --packet-ids 005c9606d209a55d,091a7e32ed6cd41d,038c3eb2dfa088c7,0283788d65a673e5,17635a79021b4c65,04300cf796cccbd3,02b82823ffa9479e,19c69c438b0b6b05,05d7e5413d352371,0320d7d46fddc1da,1e4a18d596fb24ea,1863d08d6eaabb37,04172a05c74f4b76,250104ed895a789e,1a7607c26f60288c,04d55f58a0f71f14,26611333e1674405,26031ae47755d951,058eb26463e4dbba,2689c2f81def225e,27e1d095d6f5940b,05f90b54d3d3e8d1,27a2c35acd82e8f1,2d4e930a7ac6f5a5 --out data/phase25-exit/af227-realism-cross-model
    check: 同一批 24 packet 在 MiniMax 与豆包各两位评分员下 96 次评分全部完成，无 dimension_missing、无 finish_reason=length
    threshold: exit=0 且 packets=24、ratings=96、failed=0、truncated=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty
successCriteria:
  - 豆包默认评分模型由 LLM_DOUBAO_MODEL 单一来源解析，缺省回落到 doubao-seed-2-1-pro-260915；启动注册不再出现已下线的 doubao-pro-32k。
  - 豆包评分实例支持关闭 thinking；R6-D 的豆包四次调用 reasoning token 为 0，不因思考吃满生成长度预算。
  - 新增 2×2 跨模型评分 CLI：同一 packet、同一提示词、同一证据校验，MiniMax 与豆包各跑 T=0.1 与 T=0.5 两位评分员；不把不同模型分数强行合成单一总分。
  - 复用 R6-C 前 24 个 packet，三场景各 8 个；报告保存 packetId 与逐评分员分数，任何工件不出现台词原文。
  - 报告同时给出模型内一致性、同温度跨模型一致性、模型均值差、逐 packet 绝对差与按模型场景切片；判定规则在代码中单点定义，不按结果临时改阈值。
  - 科学判定阈值预登记：跨模型总体线性加权 κ ≥ 0.4；五维 within±1 ≥ 0.8；总体绝对差均值 ≤ 0.3；总体场景排序不得翻转。任一不达即标 fail 或 conditional，并停止扩大线上样本。
  - 不修改 R5 五维锚点与证据契约；不修改 engine-core；不碰 admin-dashboard 与 Flutter；不把 AI 预评审写成临床达标。
  - 全量测试、typecheck、lint 全绿；engine-core 零 diff；交付记录、机读回执、归档与 PR 齐全。
---

# AF-227 · 来访者真人度 R6-D：MiniMax × 豆包 Seed 2.1 Pro 跨模型评分校验

## 1. 背景

R6-C 已经用真实线上 voice/text 批次补齐场景样本，24 个 packet 全部完成，但两个评分员和仲裁都来自 MiniMax：高分一致可能只是同源模型的稳定偏好，不能证明“这套评分尺子跨模型仍成立”。豆包 API key 已在本机可用，方舟现行 `doubao-seed-2-1-pro-260915` 可直连；本轮把豆包作为独立第二模型接进同一套评分协议，先验证尺子，再决定是否扩样本。

## 2. 本单目标

1. 模型配置治本：`LLM_DOUBAO_MODEL` 进入 provider-env 单一来源；`DoubaoChatProvider` 支持默认模型与 provider 级 `modelKwargs`；启动注册不再硬编码已下线模型。
2. 评分运行时：新增可复用的评分员端点工厂与调用层，支持指定 provider、模型、温度、thinking 开关；MiniMax 与豆包共用同一提示词、解析器、证据校验与重试策略。
3. 2×2 设计：同一 packet 上跑 MiniMax T=0.1 / T=0.5 与豆包 T=0.1 / T=0.5 四位评分员。模型内一致性衡量评分噪声；同温度跨模型一致性衡量模型差异；不做强行仲裁合并。
4. 真实复评：复用 R6-C 前 24 个 packet（三场景各 8），跑 96 次评分，生成 `report.json` 与 `summary.md`，给出预登记阈值的 pass / conditional / fail 判定。

## 3. 不做

- 不换 R5 五维锚点、不改证据校验、不为跨模型一致而放宽评分。
- 不把豆包分数与 MiniMax 分数平均成“更权威”的单一临床分。
- 不把本轮 AI 预评审写成真人督导或临床达标。
- 不扩到 48 / 96 / 360 场；本轮只做 24 packet 尺子校验。
- 不改 admin-dashboard、Flutter、engine-core、编排脚本。

## 4. 闸门

见 frontmatter `gates`。定向测试至少覆盖：

- `LLM_DOUBAO_MODEL` 空白回落、显式覆盖、启动注册读取；
- Doubao provider 的默认模型与 `modelKwargs` 合并，thinking disabled 请求体形状；
- 评分端点工厂按 provider 取正确 key、模型、温度与 thinking；
- 跨模型统计对完全一致、系统偏移、模型内噪声三类合成数据给出预期 κ / 差值 / 判定。

## 5. 交付

- 交付记录：`docs/worklog/completed/phase2.5/af227-realism-r6d-cross-model-2026-11-21.md`
- 跨模型报告：`data/phase25-exit/af227-realism-cross-model/report.json`（gitignored）
- 人类可读摘要：`data/phase25-exit/af227-realism-cross-model/summary.md`（gitignored）
- 机读回执：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-227/`
