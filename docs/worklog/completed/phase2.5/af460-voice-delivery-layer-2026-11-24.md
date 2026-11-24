# AF-460 交付记录：统一语音交付档案、三模型渲染器与专业语音形态预览

- 日期：2026-11-24
- 任务：AF-460（contextId `phase2.5-voice-delivery`，executor）
- 基线：`b93563394e12be1d8a182b3c242ba72dacd465eb`（`integrate`，AF-459 squash 合并点）
- 分支：`task/AF-460-voice-delivery`
- 结论：**passed** — 语音交付从"文本侧有停顿标记"升级为"厂商无关交付档案 + 三家渲染器 + 生产下发队列 + 调试页逐句审计"；闸门全绿，engine-core 零改动；真机听感与自定义音色 UI 明确留作后续，不声称关闭。

## 根因与方案

AF-459 只解决了"文本里有没有韵律标记"，现场验收仍能看到三个缺口：

1. 预览没有真实使用角色 `style/difficulty`，历史轮一律按 `light` 算，`(laughs)`、`<#x#>` 等标记自然不会出现；
2. 语速/音量/音调只存在于 env，没有按来访者画像推导，也没有映射进豆包 `audio_params`；
3. 只有 filler/pause/trailoff，没有真实思考段、长沉默、呼吸/叹气，阻抗型来访者的"停顿"不够临床可信。

AF-460 的口径是**先把"这个人这句话会怎么说"定下来，再映射到 TTS**：

- `VoiceDeliveryProfile` 厂商无关，按角色画像、风格、难度、语义情绪确定性生成，同一轮重放不漂移；
- 四层节奏：句内 0.3–1.0s 停顿、思考段 1.5–2.8s、长沉默 3.5–9s、低频副语言；
- MiniMax / 豆包 2.0 各自声明能力并映射真实参数，不支持的能力明确标注，不伪造标签；
- 生产 MiniMax 长沉默用"下一句下发前延迟"实现，用户打断即取消；
- 调试页三家 tab，逐句展示 `speechText`、`ttsText`、事件、计划/实际静默、预计时长与能力警告；
- 自定义音色已留 `voiceId` 贯通位（DTO / controller / service / 缓存键 / 生产握手）。

设计细节见 `docs/runbooks/voice-prosody-pipeline.md` §2–§6.1、§10–§11。

## 改动

### 新增：`src/shared/voice-delivery/`（纯层，零 IO）

| 文件                        | 内容                                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `voice-delivery.types.ts`   | `VoiceDeliveryProfile / VoiceDeliveryInput`；情绪、风格、难度归一化；`neutral → calm` 防非法枚举                                                                     |
| `voice-delivery.profile.ts` | `buildVoiceDeliveryProfile()`：风格/难度/情绪/效价/唤醒/话量基线 → 语速 0.86–1.08、音量 0.88–1.06、音调 -3–2；豆包风格指令明确"真实来访者口吻，不要新闻播报或播音腔" |
| `voice-delivery.render.ts`  | 两家能力声明；`toMiniMaxVoiceSetting`、`toDoubaoAudioParams`；`renderMiniMaxDelivery`、`renderDoubaoDelivery`；实际静默只统计真正落进 `ttsText` 的 `<#x#>`           |
| `index.ts`                  | 统一出口                                                                                                                                                             |

### 扩展：`src/shared/prosody/`

| 文件                | 改动                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `prosody.types.ts`  | 事件扩为 `filler / pause / trailoff / thinking / silence / breath / sigh`；配额与 apply 上下文增加思考段/长沉默/副语言计数          |
| `prosody-plan.ts`   | light 只保留一次短思考；medium 思考段 2、长沉默 1、副语言 2；L3 长沉默 5–9s；默认 medium 3.5–7s                                     |
| `prosody-inject.ts` | 新增思考段（口头语 + `[beat:x]`）、句末长沉默、句首呼吸/叹气；阶段 helper 重构，按顺序互斥取号，原有 pause/filler/trailoff 行为不变 |
| `prosody-text.ts`   | `renderMiniMaxText` 支持 pause/beat/silence/breath/sigh 分别夹取；句中副语言清洗；连续停顿只保留一条                                |

### 修改：生产语音链路

| 文件                               | 改动                                                                                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/voice/tts/tts.types.ts`       | `TtsOptions.delivery?`                                                                                                                                                             |
| `src/voice/tts/tts-bidi-client.ts` | 消费 `delivery` 下发 speed/vol/pitch/emotion；`PendingSentence.silenceAfterMs`；新增发送队列与计时器，长沉默时延迟下一句；`finish/flush` 排队到队列清空；`cancel/terminate` 清队列 |
| `src/voice/voice.service.ts`       | `buildTurnDelivery()` 按 `emotionBaseline/defenseLevel/style/difficulty` 生成本轮档案并传入 TTS；`emotionOfBaseline` helper                                                        |

### 修改：调试后端与前端

| 文件                                          | 改动                                                                                                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/admin-debug/tts/debug-tts.dto.ts`        | 可选 `voiceId`                                                                                                                                                                         |
| `src/admin-debug/tts/debug-tts.controller.ts` | render/inspect 透传 `voiceId`                                                                                                                                                          |
| `src/admin-debug/tts/debug-tts.service.ts`    | 预览扩展 provider/model/voiceId/delivery/capabilities/planned/applied/estimated；逐句 `ttsText` 走共享渲染器；`profileHintsOf` 从角色档案或内置种子取画像；`usage_json` 存脱敏请求快照 |
| `src/admin-debug/tts/debug-tts.providers.ts`  | 豆包 `audio_params` 改真实映射；`context_texts` 用组合风格指令；`additions` 开括号过滤、markdown/emoji 开关、末尾 `silence_duration`                                                   |
| `admin-dashboard/src/api/client.ts`           | 预览类型、`voiceId` 参数、完整 preview 返回                                                                                                                                            |
| `admin-dashboard/src/views/AutoPractice.vue`  | 三家 provider tabs；计划 vs 实际；逐句语义/厂商文本、事件 chip、本句静默；能力警告；句末长沉默说明                                                                                     |

### 测试

| 文件                                                | 覆盖                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `test/shared/voice-delivery/voice-delivery.spec.ts` | 8 例：确定性、风格差异、参数范围、播音腔指令、两家映射、句内/句末长沉默落地差异      |
| `test/shared/prosody/prosody-inject.spec.ts`        | 11 例：原 7 例 + 思考段位置/时长、长沉默区间、副语言句首、light 不开启长沉默与副语言 |
| `test/shared/prosody/prosody-text.spec.ts`          | 14 例：新增 beat/silence/副语言渲染与清洗                                            |
| `test/admin-debug/debug-tts.spec.ts`                | 8 例：新增 inspect 预览、`voiceId` 缓存隔离、豆包参数/风格指令/末尾静默              |

## 闸门

<!-- gateResults -->

| 命令                                                                                         | 结果                                                                                     |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm vitest run test/shared/prosody test/shared/voice-delivery test/voice test/admin-debug` | exit=0；31 passed / 1 skipped（32 文件），520 passed / 4 skipped（524 用例），5.75s      |
| `pnpm test`（收尾全量一次）                                                                  | exit=0；327 passed / 1 skipped（328 文件），4898 passed / 4 skipped（4902 用例），28.29s |
| `pnpm typecheck`                                                                             | exit=0；0 error                                                                          |
| `pnpm lint`                                                                                  | exit=0；0 error 0 warning（缓存命中）                                                    |
| `git diff --stat HEAD -- src/engine-core`                                                    | 空（0 行）                                                                               |
| `admin-dashboard: pnpm type-check`                                                           | exit=0；`vue-tsc --build` 0 error                                                        |
| `admin-dashboard: pnpm build-only`                                                           | exit=0；✓ built in 2.52s                                                                 |

<!-- /gateResults -->

## scope 自检

<!-- scopeCheck -->

- 代码与测试全部落在任务单声明的 `src/shared/prosody/`、`src/shared/voice-delivery/`、`src/voice/**`、`src/admin-debug/tts/`、`test/shared/prosody/`、`test/shared/voice-delivery/`、`test/voice/`、`test/admin-debug/`、`admin-dashboard` 两文件、`docs/runbooks/voice-prosody-pipeline.md`、交付记录路径。PASS
- 未改 `src/engine-core/**`、未改 Flutter 仓、未改 `MINIMAX_LLM_MODEL` / `MINIMAX_BASE_URL`。PASS
- 未跟踪的 `CI托管方案调研-2026-11-24.md`、`待排期备忘-2026-11-24.md` 与本任务无关，未纳入提交。PASS
- 编排状态面只经 CLI 写；`task-sheet.md` 正文与 frontmatter 未手工改写。PASS

<!-- /scopeCheck -->

## 契约核对

<!-- contractChecks -->

- taskId 一致：任务单 / 分支 / 交付记录 / 回执均为 AF-460。PASS
- 状态面只经 CLI：register / promote / run-once / branch create 均走 `cli.mjs`。PASS
- 三层文本隔离：气泡 `displayText`、调试 `speechText`、TTS `ttsText` 不混用；`ttsText` 由共享渲染器唯一产出。PASS
- 厂商能力声明：不支持的能力只在 notes/警告中说明，不塞非法标签。PASS
- 向后兼容：`sentence_start` 未新增必填字段；老客户端忽略可选字段即兼容。PASS
- 六组机读标记齐全：见本记录各节。PASS

<!-- /contractChecks -->

## backlog 遗留项

<!-- backlogItems -->

- AF460-B1（verification）：未做真机 A/B 听感校准；参数区间是保守初值，需按 runbook §12 用真实来访者画像复听后再调。
- AF460-B2（frontend）：调试页尚未提供自定义音色输入控件；`voiceId` 已贯通 API/缓存，UI 留到自定义音色任务。
- AF460-B3（adapter）：豆包 3.0 文本内插笑声/叹息仍不可用；Agent Plan 当前套餐只有 2.0，需等套餐升级后加渲染器。
- AF460-B4（adapter）：豆包 2.0 无句内长停顿；生产 voice 仍只走 MiniMax，豆包仅调试对比。
- AF460-B5（verification）：历史轮预览是确定性模拟，不是历史真实发送快照；真实请求快照只对新合成写入 `usage_json`。
- AF460-B6（adapter）：句首思考静默（turn lead-in）仍未做；当前思考段是"口头语 + 句内停顿"，不是开口前静默。

<!-- /backlogItems -->

## 偏差表

<!-- deviationTable -->

| 项                 | 任务单写的                   | 实际                                                                 | 处置                                                                                          |
| ------------------ | ---------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| MiniMax 句末长沉默 | "`[silence]`→`<#1–10#>`"     | 官方会丢弃句末停顿标记，调试同步合成不含该静默                       | 生产改为发送队列延迟下一句；预览 `appliedSilenceMs` 只统计真正落进 `ttsText` 的标记，并给警告 |
| 豆包情绪           | "可用 emotion/emotion_scale" | Agent Plan 2.0 当前链路无逐字情绪参数，只有 `context_texts` 组合指令 | 情绪/强度写进 `context_texts`，不伪造 `emotion` 字段；能力声明标 `emotionParameter=false`     |
| 长沉默概率与时长   | "甚至 5–10 秒"               | 普通 medium 3.5–7s、L3 5–9s；概率 16%，每轮最多一次                  | 避免每轮都断成"掉线"；L3 才放开到 5–9s，仍受句间隔与每轮配额约束                              |
| 预览"实际静默"     | 未定义                       | 句末长沉默在同步合成里为 0，在生产流式链路才生效                     | `plannedSilenceMs` 与 `appliedSilenceMs` 分开；能力警告明确说明差异                           |
| 自定义音色         | "后续自定义音色"             | 后端 `voiceId` 已贯通；前端无输入控件                                | 后端扩展位先落地，UI 登记 AF460-B2                                                            |

<!-- /deviationTable -->

## 结论

<!-- reviewVerdict -->

passed — 交付档案、三家渲染器、生产下发队列、调试页逐句审计已闭环；定向 520 例、全量 4898 例、类型、lint、管理端 type-check/build 全绿，engine-core 零改动。播音腔通过"慢一点、低一点、收一点 + 真实来访者口吻指令"压低，但真机听感仍需现场校准；豆包 3.0 与自定义音色 UI 未落地，均已写入遗留项，不声称关闭。

<!-- /reviewVerdict -->

## commit message

`feat(af460): 统一语音交付档案与三模型渲染器（思考段/长沉默/专业预览）`
