---
taskId: AF-251
contextId: phase2.5-orchestration-closed-loop
title: 已知容器未知值的 emotion 标记投影归一化（别名映射 + 安全丢弃）
type: fix
status: backlog
baselineRef: 284fef824ff7c23f9dc2ef1f401d161f7d4ff6bf
dependsOn: [AF-248, AF-250]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T07:32:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/auto-practice/utils/
    - test/auto-practice/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af251-unknown-emotion-projection-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/af251-emotion-projection.spec.ts test/auto-practice/wp-j-p1e-semantic-tag-parser.spec.ts test/auto-practice/wp-j-p1e-streaming-semantic-preprocessor.spec.ts test/auto-practice/wp-j-p1e-minimax-tts-adapter.spec.ts
    check: 别名映射命中、不可映射值安全消费、既有 unknown 标签与模糊纠错行为不回归
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: CI 全量 typecheck 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量测试全绿，记录真实 passed/skipped 数字
    threshold: exit=0
---

# AF-251 · 未知 emotion 投影归一化

## 背景

AF-250 真实豆包 smoke 输出 `[emotion:anxiety]`，而生产语义层 `SemanticEmotion` 只认 `sad|calm|fearful|angry|happy`。`classifySemanticTag()` 对未知 emotion 返回 `value:null`，`applyEmotionTag()` 记 `'unknown'`，`keepUnknownMarkup()` 把整段标记当正文保留并报 `TAG_UNKNOWN`。结果是：

- `displayText` 保留 `[emotion:anxiety]`，客户端展示出现内部标记；
- `emotion` 为 `null`，这一轮语音拿不到情绪；
- 诊断记为 error，抬高 illegal chars。

AF-244 已实测否决“在 prompt 里硬枚举 emotion”，因此修复必须落在投影/解析层，而不是改 V5 prompt。

## 目标

1. 在 `semantic-tag-parser.ts` 增加**有限别名表**，把 Seed Character 自然产出的常见情绪词映射到 5 个合法值：
   - 焦虑族：`anxiety/anxious/nervous/worried/worry/panic/panicked/scared/afraid/fear/tense/uneasy/overwhelmed` → `fearful`
   - 悲伤族：`sadness/depressed/depression/down/unhappy/lonely/hopeless/hurt/melancholy/grief` → `sad`
   - 愤怒族：`anger/mad/annoyed/irritated/frustrated/furious/resentful` → `angry`
   - 喜悦族：`joy/joyful/glad/cheerful/excited/content/pleased/grateful/hopeful` → `happy`
   - 平静族：`neutral/peaceful/relaxed/relieved/quiet/gentle` → `calm`
2. 命中别名时：该标记被消费、`emotion` 取映射值、记 `EMOTION_ALIAS_MAPPED` warning，不计 `TAG_UNKNOWN`，不进入 `unknownTags`。
3. 对仍然无法映射的 `[emotion:xxx]`：按“已知容器、未知值”处理，**安全消费整段标记**，`emotion:null`，记 `EMOTION_VALUE_DROPPED` warning；既不让内部标记进入 `displayText`，也不把未知值猜成某个情绪。
4. 非 emotion 的未知标签（`[xyzzy]`、`[[STATE:FOO]]`）保持现有行为：原样保留正文 + `TAG_UNKNOWN` + `unknownTags` 区间，不回归。
5. 模糊拼写纠错（`[emotion:sadd]`）保持现有 `TAG_FUZZY_CORRECTED` 行为。

## 非目标

- 不改 `src/engine-core`，不改 prompt 文本，不改 V5 约束。
- 不扩 `SemanticEmotion` 枚举，不改 MiniMax TTS 官方 5 情绪映射。
- 不改流式预处理器的丢弃策略（它已经会丢弃 unknown 标记）；只保证 `parseSemanticTagFragment` 返回可消费的 tag。
- 不做情绪强度、置信度或二次分类。

## 验收

- `[emotion:anxiety]` → `emotion='fearful'`、`displayText` 不含标记、warning 含 `EMOTION_ALIAS_MAPPED`、`unknownTags` 为空、`level<=1`。
- `[emotion:depressed]` → `sad`；`[emotion:annoyed]` → `angry`；`[emotion:excited]` → `happy`；`[emotion:relieved]` → `calm`。
- `[emotion:bewildered]` → 标记被消费、`emotion=null`、warning 含 `EMOTION_VALUE_DROPPED`、`errors` 为空、`unknownTags` 为空。
- 既有 `[xyzzy]` / `[saaa]` / `[[STATE:FOO]]` 用例保持 `TAG_UNKNOWN` 与正文保留。
- 流式预处理器对 `[emotion:anxiety]` 不向 TTS 输出标记，且 `detectedEmotion='fearful'`。
- lint、CI 同口径 tsc、全量测试全绿。
