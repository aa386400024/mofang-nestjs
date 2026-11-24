# AF-459 交付记录：语音真人度确定性韵律管线与语音形态可视化

- 日期：2026-11-24
- 任务：AF-459（contextId `phase2.5-voice-prosody`，executor）
- 基线：`38639a3d24240bb6c139de9d2a9497ff9ea7cf5c`（`integrate`）
- 分支：`task/AF-459-voice-prosody-pipeline`
- 结论：**passed** — 文本侧韵律信号已确定性落地，语音链路与调试页全部接通，闸门全绿；真机听感校准仍属 WP39 未解除条件，本单不声称关闭。

## 根因与方案

AF-395 接入三模型后音色可用，但听感仍像读课文。根因不是音色，而是**文本里没有任何韵律信号**：生产 voice 链路把 LLM chunk 原样同时喂前端与 TTS，MiniMax `<#x#>` 与语气词白名单从未使用；自动对练侧的语义标记解析层因上游不产标记而空转。

AF-329 / AF-331 已证明 prompt 方案不可靠（密度失控、跨轮预算不遵守、6 轮方差近一倍，生产保持 `RENDER_REALISM_MODE=off`）。本轮改为**确定性计划 + 句级注入**：

- 计划只依据来访者风格/难度/轮次，seed = `sessionId#turnIndex`，重放不漂移；
- 每轮重置配额，不做跨轮预算；
- 展示正文、语义形态、厂商形态三层分离；
- 流式清洗器处理跨 chunk 标签，避免把 `use:0.5]` 念出来。

设计细节见 `docs/runbooks/voice-prosody-pipeline.md`。

## 改动

### 新增：`src/shared/prosody/`（纯层，零 IO）

| 文件                | 内容                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prosody.types.ts`  | 契约：`ProsodyLevel / ProsodyEvent / ProsodyTurnLimits / ProsodyTurnPlan / ProsodyApplyContext / ProsodySentenceResult`                                                     |
| `prosody-plan.ts`   | 风格映射（`defensive/resistant/avoidant → medium`，其余 `light`）、`L3` 只升不降、`off` 配额归零、确定性 seed                                                               |
| `prosody-inject.ts` | filler 只在第 0 句句首；pause 只在次级标点后、句长 ≥12、两侧 4 字符内有可发音字符；trailoff 从第 2 句起只改句号；每句 ≤1 条，受 `maxEventsPerTurn` 与 `minSentenceGap` 约束 |
| `prosody-text.ts`   | `stripProsodyMarkers()`、`renderMiniMaxText()`（夹取 0.1–1.0s、拒绝首尾/相邻）、`ProsodyStreamSanitizer`（未闭合 `[`/`(` 先扣住，缓冲上限 32）                              |
| `index.ts`          | 统一导出                                                                                                                                                                    |

概率口径互斥：`filler 45% + pause 35% + trailoff 20% = 100%`（medium），`light` 保留 20% 静默余量。首版曾出现 `55 + 50 > 100` 导致 trailoff 号段永远取不到，单测在闸门阶段暴露并已修正为 45/35。

### 修改：语音链路

| 文件                               | 改动                                                                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/voice/tts/tts.types.ts`       | `TtsOptions.prosody?`；`sentence_start` 增加可选 `speechText` / `events`                                                                                                                                            |
| `src/voice/tts/tts-bidi-client.ts` | `PendingSentence{display,speech,events}`；`decorateSentence()` 先应用计划再渲染 MiniMax；2205 队列溢出重发用已渲染文本，不重算韵律                                                                                  |
| `src/voice/voice.service.ts`       | `prosodyEnabled`（`MINIMAX_TTS_PROSODY_MODE !== 'off'`）；`beginTtsTurn` 建计划并塞进 `TtsOptions`；`consumeLlmStream` 每轮新建清洗器，气泡与 TTS 都只用清洗后文本；`forwardTtsEvent` 下发 `speechText` / `prosody` |
| `src/voice/voice.types.ts`         | `sentence_start` 帧补可选字段（老客户端忽略即兼容）                                                                                                                                                                 |
| `src/config/envs/default.ts`       | `minimax.ttsProsodyMode` 默认 `active`                                                                                                                                                                              |
| `.env.example`                     | 新增 `MINIMAX_TTS_PROSODY_MODE=active` 与回退说明                                                                                                                                                                   |

### 修改：调试页

| 文件                                          | 改动                                                                                                                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/admin-debug/tts/debug-tts.service.ts`    | `buildSpeechPreview()`（display / speech / tts / 逐句事件）；`render()` 返回预览并让 MiniMax 用 `ttsText`；新增 `inspect()`（只读、不合成、不计费）；`mapMiniMaxEmotion` 修正 `calm`（官方无 `neutral`，原实现会报 2013） |
| `src/admin-debug/tts/debug-tts.controller.ts` | 新增 `POST /admin/api/debug/tts/inspect`                                                                                                                                                                                  |
| `admin-dashboard/src/api/client.ts`           | 预览类型、`tts()` 返回扩展、`debugSession.ttsInspect()`                                                                                                                                                                   |
| `admin-dashboard/src/views/AutoPractice.vue`  | 来访者气泡"语"按钮；首次走 `inspect`（固定 `minimax-turbo` 预览）；面板逐句展示 `speechText` + 事件 chip + 厂商合成文本；合成成功顺带缓存预览                                                                             |

### 测试

| 文件                                         | 覆盖                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `test/shared/prosody/prosody-plan.spec.ts`   | off 归零、风格映射、L3 只升不降、同 seed 幂等                                                      |
| `test/shared/prosody/prosody-inject.spec.ts` | off 逐字不改、每句 ≤1、filler 仅第 0 句、pause 位置合法、trailoff 起点、配额用尽、间隔约束         |
| `test/shared/prosody/prosody-text.spec.ts`   | 渲染合法/夹取/首尾丢弃/相邻丢弃、标记清洗（保留非白名单括号）、跨 chunk 标签与语气词、轮末残片丢弃 |
| `test/admin-debug/debug-tts.spec.ts`         | 原断言 `neutral` 改为 `calm`（该断言本身锁的是错误行为，属本任务必改）                             |

## 闸门

<!-- gateResults -->

| 命令                                                              | 结果                                                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm vitest run test/shared/prosody test/voice test/admin-debug` | exit=0；30 passed / 1 skipped（31 文件），502 passed / 4 skipped（506 用例）             |
| `pnpm test`（收尾全量一次）                                       | exit=0；326 passed / 1 skipped（327 文件），4880 passed / 4 skipped（4884 用例），27.49s |
| `pnpm typecheck`                                                  | exit=0；0 error                                                                          |
| `pnpm lint`                                                       | exit=0；0 error 0 warning                                                                |
| `git diff --stat HEAD -- src/engine-core`                         | 空（0 行）                                                                               |
| `admin-dashboard: pnpm type-check`                                | exit=0；`vue-tsc --build` 0 error                                                        |
| `admin-dashboard: pnpm build-only`                                | exit=0；✓ built in 2.70s                                                                 |

<!-- /gateResults -->

## scope 自检

<!-- scopeCheck -->

- 代码与测试全部落在任务单声明的 `src/shared/prosody/`、`src/voice/**`、`src/admin-debug/tts/`、`src/config/envs/default.ts`、`test/shared/prosody/`、`test/voice/`、`test/admin-debug/`、`admin-dashboard` 两文件、`.env.example`。PASS
- 设计说明与交付记录路径与 `artifacts` 声明一致。PASS
- 未改 `src/engine-core/**`、未改 Flutter 仓、未改 `MINIMAX_LLM_MODEL` / `MINIMAX_BASE_URL`。PASS
- 未跟踪的 `CI托管方案调研-2026-11-24.md`、`待排期备忘-2026-11-24.md` 与本任务无关，未纳入提交。PASS

<!-- /scopeCheck -->

## 契约核对

<!-- contractChecks -->

- taskId 一致：任务单 / 分支 / 交付记录 / 回执均为 AF-459。PASS
- 状态面只经 CLI：登记、提级、领单均走 `cli.mjs`，未手改索引。PASS
- 帧契约向后兼容：`sentence_start` 只新增可选字段，`text` 语义不变。PASS
- 三层文本隔离：气泡只拿 `displayText`；TTS 只拿厂商渲染文本；`speechText` 仅调试可见。PASS
- 回退口径：`MINIMAX_TTS_PROSODY_MODE=off` 时计划归零、可选字段不下发。PASS
- 六组机读标记齐全：见本记录各节。PASS

<!-- /contractChecks -->

## backlog 遗留项

<!-- backlogItems -->

- AF459-B1（adapter）：句首"思考静默"（300–700ms）未实现；需客户端插静默或服务端延迟首句，属跨端改动。
- AF459-B2（adapter）：`voice_setting.emotion` 仍未按轮下发；WP39 解除条件是真机听感校准，本轮刻意不做。
- AF459-B3（frontend）：Flutter 客户端尚无"语音形态"切换；WS 字段已兼容，UI 待独立仓排期。
- AF459-B4（adapter）：豆包链路 `ttsText` 仍为纯文本，只提供语义预览，未落地豆包侧停顿标记。
- AF459-B5（verification）：未做真机听感 A/B（`active` vs `off`），现场校准需按 runbook §12 执行。

<!-- /backlogItems -->

## 偏差表

<!-- deviationTable -->

| 项                   | 任务单写的            | 实际                                                                 | 处置                                                                             |
| -------------------- | --------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 停顿位置合法性       | "两侧必须可发音"      | 允许标点贴边（`…，<#0.4#>工作…`），但要求左右 4 字符内存在可发音字符 | 改 `canPlacePause` 为向前/向后扫描；否则注入在次级标点后的停顿会被渲染层全部丢弃 |
| 概率配额             | 未写具体数字          | medium 首版 55/50/20 超过 100，trailoff 永远不命中                   | 单测暴露后改为 45/35/20；light 为 45/35/0                                        |
| `debug-tts` 既有测试 | 断言 `calm → neutral` | 官方枚举无 `neutral`，该断言锁的是 bug                               | 改为断言 `calm` 原样透传，并在注释写明 2013 风险                                 |
| 流式清洗 trim        | 未写                  | 逐 chunk `trim()` 会吃掉英文单词间空格                               | 去掉 trim，只压缩连续空格                                                        |

<!-- /deviationTable -->

## 结论

<!-- reviewVerdict -->

passed — 确定性韵律模块、语音链路、调试页三层已闭环；定向与全量单测、类型、lint、管理端构建全绿，engine-core 零改动；回退开关与未落地项均已写明，未越过 WP39/WP40 解除条件。
<!-- /reviewVerdict -->

## commit message

`feat(af459): 语音真人度确定性韵律管线与语音形态可视化`
