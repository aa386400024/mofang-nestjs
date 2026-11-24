---
taskId: AF-460
contextId: phase2.5-voice-delivery
title: 统一语音交付档案与三模型渲染器（动态停顿/思考段/长沉默/专业预览）
type: implementation
status: backlog
baselineRef: b93563394e12be1d8a182b3c242ba72dacd465eb
dependsOn: []
priorTasks: [AF-459, AF-395, AF-331, AF-342]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2, conventions.md#5.3]
createdAt: 2026-11-24T14:20:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/prosody/
    - src/shared/voice-delivery/
    - src/voice/voice.service.ts
    - src/voice/voice.types.ts
    - src/voice/tts/tts.types.ts
    - src/voice/tts/tts-bidi-client.ts
    - src/admin-debug/tts/
    - src/config/envs/default.ts
    - test/shared/prosody/
    - test/shared/voice-delivery/
    - test/voice/
    - test/admin-debug/
    - admin-dashboard/src/views/AutoPractice.vue
    - admin-dashboard/src/api/client.ts
    - .env.example
    - docs/runbooks/voice-prosody-pipeline.md
    - docs/worklog/completed/phase2.5/af460-voice-delivery-layer-2026-11-24.md
    - docs/worklog/records/phase2.5-voice-delivery/AF-460/
  modules:
    - shared/prosody
    - shared/voice-delivery
    - voice/tts
  interfaces:
    - VoiceServerMessage.sentence_start
    - AdminDebugTtsSpeechPreview
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af460-voice-delivery-layer-2026-11-24.md
    kind: report
  - name: 语音交付层设计说明
    path: docs/runbooks/voice-prosody-pipeline.md
    kind: document
gates:
  - command: pnpm vitest run test/shared/prosody test/shared/voice-delivery test/voice test/admin-debug
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
  - 新增厂商无关的 VoiceDeliveryProfile（情绪/强度/语速/音量/音调/风格依据/预算），按来访者风格、难度、轮次与语义情绪确定性生成，不使用随机不可复现行为。
  - 韵律计划扩展为短停顿、思考段、副语言（呼吸/叹气）、长沉默四层，带每轮配额、句间隔与 L3 只升不降；off/light/medium 行为可解释。
  - MiniMax 渲染器：voice_setting 使用 profile 的 speed/vol/pitch/emotion；短停顿 0.1–1.0s、思考段 0.5–3.0s、长沉默 1.0–10.0s 分别映射为合法的停顿标记，副语言只在句首低频出现。
  - 豆包 2.0 渲染器：真实映射 speech_rate/loudness_rate/pitch_rate；context_texts 输出一条组合风格指令；trailing silence_duration 与 max_length_to_filter_parenthesis 可用；不生成 2.0 不支持的 `<#x#>`/SSML break，并在预览中给出能力警告。
  - 调试页三模型并排预览：展示 provider、模型、音色、emotion、speed/volume/pitch、逐句 speechText/ttsText、事件 chip、计划静默与预计总时长；历史轮次明确标“模拟预览”，合成成功后展示真实请求快照。
  - 支持自定义音色：debug 渲染/预览可传 voiceId 覆盖默认音色，缓存键包含 voiceId；provider 能力（emotion/pause marker/long silence）由渲染器声明，未来 3.0 可单加渲染器而不改上层。
  - 生产 MiniMax 链路消费同一 profile；长沉默通过下一句下发前延迟实现，用户一开口取消计时与后续音频；未启用韵律时行为与 AF-459 前一致。
  - 定向单测覆盖确定性、配额、标记合法性、豆包参数映射、预览结构、缓存键差异；全量闸门在交付前各跑一次并记录真实数字；engine-core git diff 为空。
---

# AF-460 · 统一语音交付档案与三模型渲染器

## 背景

AF-459 交付了第一版确定性韵律管线，但验收发现：豆包链路未消费语速/音量/音调，`ttsText` 仍是纯文本；历史轮次一律按 light 计划计算，短句看不到标记；预览没有 speed/volume/pitch，也没有 `<#2#>` 以上的长停顿。用户要求把“语音真人度”提升到临床可信：真实咨询场景里的停顿、思考、犹豫、长沉默、副语言，并且调试页能逐句看到“这句话实际会怎么被念出来”。

Agent Plan 当前语音模型清单只有 `doubao-seed-tts-2.0` 与 `doubao-seed-asr-2.0`，3.0 不在套餐内；本任务按 2.0 补齐，并把 3.0 留成独立渲染器扩展位。

## 范围

- 新增 `src/shared/voice-delivery/`：厂商无关交付档案、三渲染器（MiniMax / 豆包 2.0）、能力声明与文本渲染。
- 扩展 `src/shared/prosody/`：思考段、副语言、长沉默事件与临床配额。
- `src/voice/**`：生产 MiniMax 链路消费 profile；长沉默用下发间隔实现；保持旧帧兼容。
- `src/admin-debug/tts/`：三模型参数、逐句 ttsText、能力警告、真实请求快照缓存。
- `admin-dashboard`：专业预览面板（provider tabs、参数、逐句对照、预计时长、历史模拟标识）。
- 测试、`.env.example`、设计说明与交付记录。

## 非目标

- 不改 `src/engine-core/**`。
- 不接豆包 3.0（当前 Agent Plan 不支持）；不伪造 3.0 标签。
- 不改 Flutter 客户端仓库；WS 仅新增可选字段/事件。
- 不把长沉默做成每轮固定 10 秒；必须受风格/难度/轮次配额约束。
- 不把心理文本、音频或 API key 写入普通日志。

## 验收

1. 单测覆盖：profile 确定性、计划配额与间隔、MiniMax 三类停顿合法、豆包参数映射与能力警告、预览结构、voiceId 缓存隔离。
2. 定向单测 + `pnpm typecheck` + `pnpm lint` + 全量 `pnpm test` 各跑一次，真实数字入交付记录。
3. `git diff --stat HEAD -- src/engine-core` 为空。
4. 设计说明写清四层节奏、三家能力差异、长沉默实现与打断、回退开关、自定义音色扩展位、未落地项。
5. 交付后跑一场新的自动对练做真机对照；历史会话只能标“模拟预览”，不反推真实请求。
