---
taskId: AF-461
contextId: phase2.5-voice-delivery
title: 修复三模型 TTS provider 参数类型契约（MiniMax pitch 整数 / 豆包 additions JSON 字符串）
type: fix
status: backlog
baselineRef: c239b8a7cbd33b3d8ff0579baaac1bdb1bd75b5a
dependsOn: []
priorTasks: [AF-460, AF-459]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2, conventions.md#5.3]
createdAt: 2026-11-24T15:50:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/voice-delivery/
    - src/voice/tts/
    - src/admin-debug/tts/
    - test/shared/voice-delivery/
    - test/voice/
    - test/admin-debug/
    - docs/runbooks/voice-prosody-pipeline.md
    - docs/worklog/completed/phase2.5/af461-tts-provider-type-contract-2026-11-24.md
    - docs/worklog/records/phase2.5-voice-delivery/AF-461/
  modules:
    - shared/voice-delivery
    - voice/tts
    - admin-debug/tts
  interfaces:
    - AdminDebugTtsSpeechPreview
    - TtsOptions.delivery
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af461-tts-provider-type-contract-2026-11-24.md
    kind: report
gates:
  - command: pnpm vitest run test/shared/voice-delivery test/voice test/admin-debug
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
  - MiniMax voice_setting 的 pitch 始终为整数并夹在 [-12,12]；speed 保留 float 且夹在 [0.5,2]，vol 保留 float 且夹在 (0,10]，不允许 NaN/Infinity 进入请求体。
  - MiniMax 调试同步合成与生产 WebSocket 握手复用同一份 voice_setting 映射，不再各写一套数值逻辑。
  - 豆包 req_params.additions 始终序列化为 JSON 字符串，而不是对象；max_length_to_filter_parenthesis 按官方语义设为 100（过滤短括号注释），disable_markdown_filter / disable_emoji_filter 为 true，末尾 silence_duration 仅在 >0 时写入。
  - 交付档案的 pitch 在源头量化为整数，调试预览展示的 pitch 就是实际下发给 provider 的值，不出现“预览 -0.7、实际 -1”的漂移。
  - 定向单测直接断言 MiniMax 请求体 pitch 为整数、豆包 additions 可 JSON.parse 且字段类型正确；全量闸门在交付前各跑一次并记录真实数字；engine-core git diff 为空。
---

# AF-461 · 修复三模型 TTS provider 参数类型契约

## 背景

AF-460 合并后，用户在调试引擎页对第 29 轮点击语音 icon，三家 provider 全部返回 503。复现结果：

- `minimax-hd` / `minimax-turbo`：MiniMax `2013 invalid params, Mismatch type int64`，请求体 `pitch=-0.7`。官方要求 `pitch` 为整数，`speed/vol` 才是 float。
- `doubao-seed-tts-2.0`：`json: cannot unmarshal object into Go struct field TTSReqParams.req_params.additions of type string`。官方要求 `additions` 是 JSON 序列化后的字符串。

这不是 provider 故障，而是我们把内部 `number` 直接透传成厂商强类型字段；TypeScript 的 `number` 不区分 int/float，现有测试也只断言了值、没有断言类型。生产 MiniMax WebSocket 链路使用同一份 `voice_setting` 数值，同样会中招。

## 目标

1. 把 MiniMax 数值映射收敛到一个共享函数，调试与生产共用；pitch 取整，speed/vol 做有限性与范围夹取。
2. 豆包 `additions` 按官方要求序列化为 JSON 字符串，并修正括号过滤/Markdown/Emoji 的语义取值。
3. 交付档案在源头把 pitch 量化为整数，保证调试预览与实际下发一致。
4. 补类型契约测试，避免“测试只比数值、厂商按类型拒绝”的盲区。
