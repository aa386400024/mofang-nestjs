---
taskId: AF-459
contextId: phase2.5-voice-prosody
title: 语音真人度确定性韵律管线（停顿/思考垫/拖音）与语音形态文本可视化
type: implementation
status: backlog
baselineRef: 38639a3d24240bb6c139de9d2a9497ff9ea7cf5c
dependsOn: []
priorTasks: [AF-327, AF-328, AF-329, AF-331, AF-342, AF-395]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2, conventions.md#5.3]
createdAt: 2026-11-24T11:40:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/prosody/
    - src/voice/voice.service.ts
    - src/voice/voice.types.ts
    - src/voice/tts/tts.types.ts
    - src/voice/tts/tts-bidi-client.ts
    - src/admin-debug/tts/
    - src/config/envs/default.ts
    - test/shared/prosody/
    - test/voice/
    - test/admin-debug/
    - admin-dashboard/src/views/AutoPractice.vue
    - admin-dashboard/src/api/client.ts
    - .env.example
    - docs/runbooks/voice-prosody-pipeline.md
    - docs/worklog/completed/phase2.5/af459-voice-prosody-pipeline-2026-11-24.md
    - docs/worklog/records/phase2.5-voice-prosody/AF-459/
  modules:
    - shared/prosody
    - voice/tts
  interfaces:
    - VoiceServerMessage.sentence_start
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af459-voice-prosody-pipeline-2026-11-24.md
    kind: report
  - name: 韵律管线设计说明
    path: docs/runbooks/voice-prosody-pipeline.md
    kind: document
gates:
  - command: pnpm vitest run test/shared/prosody test/voice test/admin-debug
    check: 定向单测全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exit=0
  - command: pnpm lint
    check: ESLint 0 error
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 纯层零改动
    threshold: exit=0
successCriteria:
  - 新增厂商无关的确定性韵律模块（shared/prosody）：按来访者风格/难度/轮次做确定性计划，不用 prompt 预算，不引入随机不可复现行为。
  - 语音链路在句级下发前注入语义韵律标记，displayText 与 speechText/ttsText 严格分离：气泡正文不出现方括号标签，TTS 收到厂商标记。
  - MiniMax bidi 支持句内停顿 <#x#>，时长/位置合法（不连用、不在句首句尾、0.1–1.0s），且每轮事件数受上限约束。
  - sentence_start 帧新增可选 speechText 字段，老客户端不识别即忽略，向后兼容。
  - 调试页三模型 TTS 返回可读的语音形态文本（语义标记 + 事件表），来访者气泡提供“语音形态”切换；不触发合成也能预览。
  - 修复 debug-tts 把 calm 映射成 neutral 的非法枚举 bug（官方中性值只有 calm）。
  - 全量闸门在交付前各跑一次并记录真实数字；engine-core git diff 为空。
---

# AF-459 · 语音真人度确定性韵律管线

## 背景

AF-395 接入三个 TTS 模型后，音色可用，但听感仍是「读课文」：句间太顺、没有思考与犹豫。根因不在音色，而在**文本侧没有任何韵律信号**：生产 voice 链路把 LLM chunk 原样同时喂前端与 TTS，MiniMax 的 `<#x#>` 停顿与语气词白名单从未被使用；自动对练侧虽然存在语义标记解析层，但上游 prompt 不产标记，解析空转。

AF-329/AF-331 已证明「靠 prompt 教模型自然停顿」不可靠（密度失控、跨轮预算不遵守、6 轮方差近一倍）。因此本任务改为**确定性注入**：模型只负责干净口语，韵律由服务端按临床画像做计划并在句级渲染，过程可审计、可回退、可单测。

## 范围

- `src/shared/prosody/`：纯函数韵律计划 + 注入 + MiniMax 渲染 + 标记清洗
- `src/voice/**`：句级接入、`sentence_start.speechText`、TTS 参数
- `src/admin-debug/tts/`：语音形态文本返回 + calm 枚举修复
- `admin-dashboard`：气泡「语音形态」切换（本任务单明确授权）
- 测试、`.env.example`、设计说明与交付记录

## 非目标

- 不改 `src/engine-core/**`
- 不改 prompt 里的真人度配额（AF-331 结论：生产保持 off，不继续加配额）
- 不做情绪 `voice_setting.emotion` 的临床映射（WP39 解除条件是真机听感校准，未完成）
- 不改 Flutter 客户端仓库；WS 仅新增可选字段
- 不声称关闭 Phase4 WP39 / WP40 的正式解除条件

## 验收

1. 单测覆盖：计划确定性、风险/风格配额、停顿位置合法性、标签清洗、渲染合法、帧字段兼容。
2. `pnpm lint` / `pnpm typecheck` / `pnpm vitest run` 定向与收尾全量各一次，数字入交付记录。
3. `git diff --stat HEAD -- src/engine-core` 为空。
4. 设计说明写清分层、注入规则、回退开关、未落地项（句首思考静默、情绪映射、Flutter 端切换）。
