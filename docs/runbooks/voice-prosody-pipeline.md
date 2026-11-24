# 语音真人度 · 确定性韵律管线（AF-459 / AF-460）

> 目标：让 AI 来访者的语音听起来像"在想事情的人"，而不是"在读稿子"。
> 适用范围：`src/shared/prosody/`、`src/shared/voice-delivery/`、`src/voice/**`、`src/admin-debug/tts/**`、`admin-dashboard` 调试页。
> 结论先行：音色已经够用，缺的是**文本侧的韵律信号 + 厂商参数的真实映射**。AF-459 把"停顿 / 思考垫 / 拖音"从"靠模型自觉"改成"服务端确定性计划 + 句级注入"；AF-460 再把情绪、语速、音量、音调、思考段、长沉默、副语言统一成一份厂商无关的 `VoiceDeliveryProfile`，由三家渲染器各自落地，并让调试页逐句展示"计划值 vs 实际会进音频的值"。

## 1. 为什么不再用 prompt 方案

AF-329 / AF-331 已经用真实数据否定过"在 prompt 里教模型自然停顿"：

- 事件密度失控、跨轮预算不遵守，6 轮短会话方差接近一倍；
- 从 `full` 降到 `no-event` 时，密度才降到 2.86 / 2.05，说明模型并不按预算执行；
- 生产因此保持 `RENDER_REALISM_MODE=off`。

所以本轮的原则是：**模型只负责干净口语；韵律由确定性计划决定，按句注入，每轮重置。** 不再新增 prompt 配额，也不做跨轮预算。

## 2. 三层文本必须分开

| 层            | 内容                                                                 | 谁用                     | 约束               |
| ------------- | -------------------------------------------------------------------- | ------------------------ | ------------------ |
| `displayText` | 纯正文                                                               | 气泡、逐字稿、审计       | 一个标签都不能有   |
| `speechText`  | 语义形态（`[pause:0.4]`、`[beat:1.8]`、`[silence:5.2]`、`[breath]`） | 管理端"语音形态"、事件表 | 人类可读、厂商无关 |
| `ttsText`     | 厂商形态（MiniMax `<#0.4#>` / `(breath)`；豆包为纯文本）             | 只发给 TTS               | 不回前端当正文     |
| `delivery`    | 情绪 / 语速 / 音量 / 音调 / 风格 / 难度 / 豆包风格指令               | 三家渲染器 + 调试页审计  | 厂商无关、确定性   |

分离的直接收益：换厂商只换渲染器；调试页能对照"这句话怎么被念出来的"；历史 prompt 里残留的 `[pause:0.5]` 不会再被念出来或出现在气泡里。

## 3. 分层结构

```
src/shared/prosody/            纯函数层：零 IO、零 Nest、零网络
├── prosody.types.ts           契约（plan / event / limits / sentence result）
├── prosody-plan.ts            风格/难度 → 强度档 + 配额 + 确定性 seed
├── prosody-inject.ts          句级注入（thinking / filler / pause / silence / breath / trailoff）
├── prosody-text.ts            标记清洗、MiniMax 渲染、流式清洗器
└── index.ts                   统一出口

src/shared/voice-delivery/     交付层：厂商无关档案 + 三家渲染器
├── voice-delivery.types.ts    情绪/风格/难度归一化
├── voice-delivery.profile.ts  角色画像 → 语速/音量/音调/豆包风格指令
├── voice-delivery.render.ts   能力声明 + 参数映射 + 文本渲染
└── index.ts                   统一出口

src/voice/
├── voice.service.ts           每轮建 delivery + prosody → 塞进 TtsOptions
└── tts/tts-bidi-client.ts     按句落地计划 + 渲染；长沉默用下发队列延迟

src/admin-debug/tts/           只读预览（inspect）+ 三模型合成（render）
admin-dashboard/               来访者气泡"语"按钮 + 语音形态面板
```

纯层不认业务枚举，只认 `style: string`；业务侧负责映射，避免把 `engine-core` 或 voice 的领域类型反向渗进纯层。

## 4. 本轮计划怎么定

| 输入                                   | 结论                              | 理由                                   |
| -------------------------------------- | --------------------------------- | -------------------------------------- |
| 总开关 `off`                           | `level=off`，`maxEventsPerTurn=0` | 与改前逐字一致，可现场回退             |
| `cooperative` / `mixed` / 未给         | `light`                           | 配合度高，表达相对流畅，只保留少量痕迹 |
| `defensive` / `resistant` / `avoidant` | `medium`                          | 开口前先掂量、句中断句多，符合阻抗画像 |
| 难度 `L3`                              | 至少 `medium`（只升不降）         | 难度越高不能反而越顺                   |

配额（每轮重置）：

| 档       | 每轮事件上限 | 事件间隔  | 思考段             | 句内停顿  | 长沉默             | 副语言        | 拖音      |
| -------- | ------------ | --------- | ------------------ | --------- | ------------------ | ------------- | --------- |
| `light`  | 2            | ≥1 句     | 概率 9%，0.8–1.5s  | 概率 30%  | 关闭               | 关闭          | 关闭      |
| `medium` | 3            | ≥1 句     | 概率 18%，1.5–2.8s | 概率 30%  | 概率 16%，3.5–7s   | 概率 7%，句首 | 概率 20%  |
| L3       | 同 medium    | 同 medium | 同 medium          | 同 medium | 概率 16%，**5–9s** | 同 medium     | 同 medium |

所有阶段按顺序互斥取号（思考段 → 旧 filler → 长沉默 → 句内停顿 → 副语言 → 拖音），不会一局里叠两层。`light` 的思考段只在本轮第 0 句，长沉默/副语言完全关闭——配合型来访者本来就更顺，不能演成每句都在酝酿。

确定性 seed = `${sessionId}#${turnIndex}`，同一段台词重放时韵律不漂移，单测可以直接钉住输出。

## 5. 句级注入规则

| 事件          | 位置                            | 硬约束                                                                                |
| ------------- | ------------------------------- | ------------------------------------------------------------------------------------- |
| `thinking`    | 本轮第 0 句句首                 | 口头语（嗯…… / 呃…… / 那个…… / 怎么说呢……）+ `[beat:1.5–2.8]`；原句不能已以填充词开头 |
| `filler`      | 本轮第 0 句句首                 | 词表 `嗯，` `呃，` `那个，`；概率低于思考段，避免两个垫词叠加                         |
| `silence`     | 第 2 句起句末                   | 句长 ≥8、句尾必须是 `。！？`；每轮最多 1 次；medium 3.5–7s，L3 5–9s                   |
| `pause`       | 句内次级标点之后（`，、：,;:`） | 句长 ≥12；不在句首/句尾；左右 4 字符内必须能找到可发音字符；每条 0.3–0.55s            |
| `breath/sigh` | 句首                            | 只在 medium、低频；渲染只在句首/句末标点后落地                                        |
| `trailoff`    | 句末                            | 从第 2 句起；只把 `。` 改 `……`；`light` 不启用                                        |

每句最多 1 条事件；每轮受 `maxEventsPerTurn` 与 `minSentenceGap` 双重约束。`displayText` 永远是原句，事件只改 `speechText`。

## 6. MiniMax 文本合法性

`renderMiniMaxText()` 把语义标记渲染成 MiniMax 形态，并按类型分别夹取：

1. `pause` 夹 `[0.1, 1.0]` 秒、`beat` 夹 `[0.5, 3.0]` 秒、`silence` 夹 `[1.0, 10.0]` 秒，最多两位小数；
2. 左侧与右侧都必须有可发音文本（标点可以贴在停顿边上，例如 `…，<#0.4#>工作…`，这是最自然的断点）；
3. 句首/句尾的停顿直接丢弃；
4. 相邻停顿只保留第一条（官方不允许连用）；
5. `[breath]` / `[sigh]` → `(breath)` / `(sighs)`，只允许句首或句末标点后；句子中间的会被丢弃，避免"我（吸气）有点累"的朗读腔。

渲染失败的停顿不会"带病下发"，而是退回纯文本——宁可少一个停顿，也不让上游报 2013。

**句末长沉默**：MiniMax 文本里句末 `<#x#>` 会被官方规则丢弃，所以生产链路用 `tts-bidi-client` 的下发队列延迟下一句（`silenceAfterMs`），用户打断时清空队列与计时；调试页单次同步合成不包含这段静默，预览会明确标"实际静默 0s + 句末长沉默需流式链路"。

## 6.1 交付档案与厂商映射（AF-460）

`VoiceDeliveryProfile` 是唯一真相源，字段与映射如下：

| 字段               | 来源                                       | MiniMax                       | 豆包 2.0                                   |
| ------------------ | ------------------------------------------ | ----------------------------- | ------------------------------------------ |
| `emotion`          | semantic JSON / 情绪基线                   | `voice_setting.emotion`       | 只进 `context_texts`（2.0 无逐字情绪参数） |
| `emotionIntensity` | 唤醒 + 效价                                | 影响语速/音量/音调的细微项    | 写进风格指令                               |
| `speed`            | 风格 + 情绪 + 话量基线 + 难度（0.85–1.08） | `voice_setting.speed`         | `audio_params.speech_rate`（-50–100）      |
| `volume`           | 防御水平（0.9–1.05）                       | `voice_setting.vol`           | `audio_params.loudness_rate`（-50–100）    |
| `pitch`            | 情绪效价（-4–4 半音）                      | `voice_setting.pitch`         | `audio_params.pitch_rate`（-12–12）        |
| `contextText`      | 风格 + 难度 + 情绪强度                     | 不适用                        | `context_texts[0]`（只第一条生效、不计费） |
| `voiceId`（可选）  | 调试页 / 生产握手覆盖                      | 覆盖 `voice_setting.voice_id` | 覆盖 `speaker`                             |

豆包额外开启 `additions.max_length_to_filter_parenthesis`、`disable_markdown_filter`、`disable_emoji_filter`，并在文本末尾用 `silence_duration`（0–30000ms）承接句末长沉默；句内长沉默豆包 2.0 没有对应能力，预览会明确标"未落地"。

**播音腔抑制**：`contextText` 固定写明"真实来访者口吻，不要新闻播报或播音腔"，同时把语速压到 0.85–1.08、音调限制在 ±4 半音；不靠提高音量或加情绪词来"演"。

**自定义音色扩展位**：`voiceId` 已贯通 debug DTO/controller/service、缓存键与生产 TTS 握手；未来接 3.0 或声音克隆时只新增一个渲染器 + 一个 provider 能力声明，上层 `VoiceDeliveryProfile` 不变。

## 7. 流式清洗器

旧 prompt 会教模型写 `[pause:0.5]`，而 LLM 是流式的，标签可能被拆成 `[pa` + `use:0.5]`。逐 chunk 正则替换会漏掉半个标签，把 `use:0.5]` 当正文念出来。

`ProsodyStreamSanitizer` 每轮一个实例：

- `feed(chunk)`：把最后一个未闭合的 `[` / `(` 之后的内容先扣在缓冲里，其余清洗后下发；
- 缓冲上限 32 字符，异常输入不会卡住整轮；
- `flush()`：轮末放行剩余正文，真正未闭合的残片直接丢弃；
- 清洗范围：`<#x#>`、`[pause:x]`、任意 `[...]`、MiniMax 语气词白名单（白名单外的括号内容保留，如 `（其实我也不确定）`）；
- 不做 `trim`：chunk 边界的空格属于正文，避免英文单词被拼掉。

## 8. 协议兼容

`sentence_start` 帧新增两个可选字段：

```ts
{ type: 'sentence_start'; seq: number; text: string; speechText?: string; prosody?: ProsodyEvent[] }
```

- 只有 `speechText !== displayText` 或事件非空时才下发；
- 老客户端不识别即忽略；`text` 仍是清洗后的正文，显示逻辑不变；
- Flutter 端本轮未改，切换 UI 先在管理端调试页落地。

## 9. 配置与回退

```dotenv
# active = 启用确定性韵律；off = 完全不注入（行为与改前逐字一致）
MINIMAX_TTS_PROSODY_MODE=active
```

回退只改 env，不依赖回滚代码。回退后：不下发 `speechText/prosody`，TTS 文本与改前逐字一致；`delivery` 仍然只影响 voice 链路，`admin-debug` 的预览仍可只读查看（`inspect` 不合成、不计费）。若需要退回 AF-459 的纯语速行为，把 `buildTurnDelivery` 的返回值改为 `undefined` 即可，不需要改 bidi client。

## 10. 调试与验收路径

1. 管理端自动对练页：来访者气泡工具区点"语"→ 调 `POST /admin/api/debug/tts/inspect`（只读、不合成）→ 面板顶部可切三家 provider；
2. 面板展示：情绪/强度、语速、音量、音调、风格、难度、预计时长、计划静默、实际静默、能力警告；
3. 逐句展示：`speechText`、该 provider 的 `ttsText`、事件 chip（思考段 / 长沉默 / 呼吸 / 叹息 / 停顿 / 拖音）、本句静默；
4. 三模型合成：`POST /admin/api/debug/tts/render` 返回音频 + 同一份预览；缓存命中时同样带预览；可选 `voiceId` 覆盖，缓存键包含音色；
5. 单测：计划确定性、风格/难度映射、配额与间隔、思考段/长沉默/副语言、三家渲染器参数映射、豆包 `context_texts`、缓存隔离；
6. 闸门：定向 vitest → `pnpm typecheck` → `pnpm lint` → 收尾全量 `pnpm test` → `git diff --stat HEAD -- src/engine-core` 为空。

## 11. 明确未落地（不得声称关闭）

- **豆包 3.0**：Agent Plan 当前套餐只到 `doubao-seed-tts-2.0`，文本内插笑声/叹息等 3.0 能力仍不可用；AF-460 只把 2.0 已有的 `speech_rate / loudness_rate / pitch_rate / context_texts / additions.silence_duration` 用满；
- **豆包 2.0 句内长沉默**：没有 `<#x#>` / SSML break，句内静默只能用服务端静默音频段；本轮生产 voice 仍只走 MiniMax，调试页对豆包明确标"未落地"；
- **Flutter 端"语音形态"切换**：独立仓未改，WS 字段已向后兼容；
- **真正的声音克隆/自定义音色**：调试页已留 `voiceId` 覆盖与缓存隔离；生产端音色仍走握手 `voiceId` > env，不做声纹训练；
- Phase4 `WP39` / `WP40` 仍为 P0 未关闭，本轮交付的是"文本侧韵律 + 参数映射"这一层。

## 12. 现场校准建议

- 先听 `medium`（阻抗画像）三轮，确认停顿不抢话、不破坏共情节奏；
- 若显得"太碎"，先降 `off` 验证回退，再考虑调低 `PAUSE_CHANCE`（当前 35%）而不是加 prompt；
- 若显得"没变化"，优先检查是否命中了 `light`（配合型画像本就应该更顺），不要盲目提高配额。
