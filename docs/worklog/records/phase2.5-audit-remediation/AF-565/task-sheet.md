---
taskId: AF-565
contextId: phase2.5-audit-remediation
title: 语音停顿分档与来访者语料去重扩充
type: implementation
status: backlog
baselineRef: 2d965fb3fb98ca5826ae038a66c3c4ec3ba39796
riskClass: R2
gateProfile: full
dependsOn:
  - AF-561
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-27T07:48:13+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/prosody/
    - src/voice/
    - src/engine-adapters/wiring/character/
    - src/engine-adapters/rendering/
    - test/shared/prosody/
    - test/voice/
    - test/engine-adapters/
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-audit-remediation/AF-565/
  modules: [voice, auto-practice]
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af565-voice-pause-lexicon-2026-11-27.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit 0
  - command: pnpm lint
    check: 0 error
    threshold: exit 0
  - command: pnpm exec vitest run test/shared/prosody test/voice test/engine-adapters
    check: 定向测试全绿
    threshold: exit 0
successCriteria:
  - 感叹停顿按语境分档，短填充词后不再出现 1.5s 以上死寂
  - 长沉默拆成“短静默 + 思考声 + 短静默”，思考声不进 display 文本
  - 填充词池扩充且按角色签名/会话轮次去重，通用池移除“那个”
  - 角色 verbalVoice 由固定句式改为行为描述 + 多种可选表达 + 频率上限
  - 同一场“那个/我分析/都有吧”等口头禅有明确上限
  - 增加可回归的单测与听感验证口径
  - engine-core 零 diff
---

# AF-565 · 语音停顿分档与来访者语料去重扩充

## 背景

2026-11-27 抽样 490 场 / 5800 轮：社交焦虑角色 732 轮中 142 轮含“那个”（19.4%），61 场中 16 场出现 ≥3 次，单场最高 8 次；理智化角色 716 轮中 169 轮以“我分析/客观来讲”开头（23.6%）。同时 `thinkingPauseMs` 为 light 800–1500ms、medium 1500–2800ms，长沉默 3.5–9s，两字填充词后听感像断线。

## 范围

- 调整 `src/shared/prosody/prosody-plan.ts` 的分档时长与配额。
- 调整 `src/shared/prosody/prosody-inject.ts` 的填充词池、选择策略与长沉默拆分。
- 调整 `src/shared/prosody/prosody-text.ts` 的 `pause`/`beat` 渲染边界。
- `src/voice/tts/tts-bidi-client.ts` 接入“长沉默中间思考声”。
- `src/voice/voice.service.ts` 传入本轮语境（风格/难度/轮次）与近轮填充词。
- 改写 `src/engine-adapters/wiring/character/character-baseline-calibration.ts` 的 10 条 verbalVoice，去除固定句式与数字秒数。
- 补 `test/shared/prosody`、`test/voice` 回归单测。

## 不在范围

- 不改 engine-core。
- 不改 MiniMax 模型/provider 选择。
- 不在本任务内重跑 1000 场批次或做人工盲评；只给验证口径与定向测试。
- 不改前端音频播放器；长沉默仍通过现有服务端 TTS 帧实现。
