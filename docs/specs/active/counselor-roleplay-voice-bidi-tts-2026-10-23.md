# 心塑 App · 全真会谈「语音对语音 · bidi 逐句出声」接入 /voice/training WS（后端开发稿）

> **文档版本**：v2.1（2026-10-23，在 v2.0 基础上补 `ready` 就绪帧消除首条竞态、补 `ws` 显式依赖验收；取代 v1.0 纯文字稿中「TTS 后置 / 不出声」结论）
> **文档状态**：后端开发稿（前端并行改造 `/training-session-route`，按本稿 WS 契约联调）
> **上游拍板**：出声形态 = 乙（官方 bidi 逐句流式，边生成边合成边播，非整段一次性合成）；输入 = 方案 1（前端 VAD 切段 + 文件 ASR，非麦克风实时 WS ASR）
> **关联规格**：复用 `/voice/training` WS、复用 `LlmService.streamChat`、复用 vpt 公共模板库与 Contributor 插槽；ASR 复用已完成的 `POST /counselor/practice/asr`（本期后端零改动）
> **官方依据**：MiniMax T2A V2 双向流式 WebSocket AsyncAPI `https://platform.minimaxi.com/docs/api-reference/speech/t2a/api/asyncapi-bidi.json`

---

## 0. 元信息与已拍板项

| 项 | 值 |
|----|----|
| 本次主任务（P0） | 来访池选 `vpt_*` 人物 → 连 `/voice/training` WS → 前端 VAD 切段 ASR 出字后发 `user_text` → 后端 LLM 流式，**边出 token 边喂官方 bidi TTS，逐句 mp3 回传前端排队出声**，形成一次可闭环、来访者真实出声的全真语音演练 |
| 拍板 ① 出声 | **乙 = bidi 逐句流式**：LLM token 流直推官方 bidi TTS，服务端自动攒句合成；不做整段 HTTP 一次性合成（用户明确否决「糊弄的整段方案」） |
| 拍板 ② 输入 ASR | **前端 VAD 切段 + 文件 ASR**：前端做静音分段，每段走现有 `POST /counselor/practice/asr` 拿文本，再 WS 发 `user_text`；本期后端**不做**麦克风实时流式 ASR（官方 .cn 站无此能力，见 §6） |
| 拍板 ③ 音频封装 | **后端按句封装完整 mp3 再发**（句级缓冲），不向前端透传官方 hex 分片；前端逐句排队播放，web/native 兼容最稳（见 §2.5） |
| 拍板 ④ vpt 透传 | 前端只传 `templateId` + 临场参数；完整 7 大块剧本后端从 `visitor_pool_templates` 读，绝不下发（沿用 v1.0 §2.3） |
| 拍板 ⑤ 打断 | 用户开口即 barge-in：abort LLM + `task_cancel` TTS；已下发音频官方不撤回，前端本地停播 |
| 拍板 ⑥ 交互（前端行为，后端对齐 barge-in 边界） | mic 按钮=**只开关收音通道**（开/关麦，关麦清草稿、不提交不打断）；进会话授权后**默认开麦待命**；说话靠开口自动（VAD 长停提交），**点页面空白处提前提交**（排除顶栏/头像/底栏热区）；speaking 中关麦只静音自己、AI 继续说完，仅开麦检测到人声才发 `user_speaking`（§2.6-4） |
| 后端现状 | LLM 已真连；WS 骨架 + barge-in 骨架在；**`tts-bidi-client.ts` 为早期自拟错误协议，须按官方重写**（§3）；vpt 注入插槽在 |
| 不做什么 | 见 §5「明确不做」 |

---

## 1. 现状扫描与必须纠正的错误（扫描日期 2026-10-23，基于后端代码）

### 1.1 可直接复用

1. **LLM 已真连**：`src/agent/llm/llm.service.ts` OpenAI 兼容 SSE，`choices[0].delta.content` 增量、AbortSignal、重试齐备，本期不改。
2. **WS 骨架与 barge-in**：`voice.gateway.ts`（path `/voice/training`，JWT query/Bearer 校验）+ `voice.service.ts` 的 `currentGeneration` 防旧流回灌、`llmAbort` abort、`user_speaking` 打断骨架均可沿用，仅需把 TTS 段换成官方实现。
3. **vpt 模板库 + Contributor 插槽 + 演练登记**：沿用 v1.0 纯文字稿 §2.2/§2.3（握手登记、`replacesPersona=true`、`script` 不下发），本稿不重复，只在 §2.2 给出增量参数。
4. **ASR 已完成**：`POST /counselor/practice/asr`（multipart `file`、header `language`、裸响应 `{text,duration,trace_id}`），本期前端切段后直接调，后端无需为全真会谈新增 ASR 端点。

### 1.2 现有 TTS 代码必须重写（`src/voice/tts/`，当前全错）

| 现状（错误） | 官方正确做法 |
|----|----|
| 自拟端点 `/v1/t2a/bidi` | `wss://api.minimax.cn/ws/v1/t2a_v2_bidi` |
| 自拟 0x01 文本帧 / 0x02 音频二进制帧 | **纯 JSON 文本帧**，无二进制头 |
| 裸 PCM Buffer 直传 | 音频在 `task_continued.data.audio`，**hex 编码 mp3 字符串**，服务端解码 |
| 模型 `speech-2.8`（不存在） | `speech-2.8-turbo`（env 可配，枚举见 §3.2） |
| 音色 `mandarin_female_001`（未核实占位） | 真实系统 `voice_id`，走 env 配置（§3.3） |
| `handleJson` 丢弃 `task_continued.audio`，只转发 sentence 事件 | 必须解出 `data.audio` hex → Buffer → 攒句 |
| `tts-bidi-pool.service.ts` config 未注入、每轮结束未 release（隐患） | 一并修正（§3.6） |

> `src/voice/asr-token/*` 继续废弃，不接。

---

## 2. P0 · WS 消息契约（前端按此对接）

### 2.1 连接握手（在现有 query 上扩展）

```
WS /voice/training/<sid>?token=<jwt>&templateId=<vpt slug>&mode=voice&difficulty=L1&style=cooperative&emotionBaseline=0.35&defenseLevel=0.2&visitorMode=useMySettings
```

- 鉴权、`<sid>`、`templateId` 校验、临场参数裁剪与回退、演练登记、vpt 剧本注入：**全部沿用 v1.0 §2.2/§2.3**，本稿只改 `mode=voice`（出声）。
- `templateId` 非空但查不到已上架模板 → `error{code:'template_not_found',retryable:false}` + `close(1008)`，不回退默认人物。
- 鉴权、模板校验、演练登记、`startSession` 全部成功后，先发一帧 `{type:'ready'}`（§2.3 帧规则 0），前端收到后才可发 `user_text`。

### 2.2 客户端 → 服务端（C→S）

```jsonc
{ "type": "user_text", "text": "你最近这段时间怎么样？", "generation": 1 }
{ "type": "user_speaking" }            // barge-in：打断当前 LLM 流 + TTS 合成
{ "type": "session_finish" }           // 主动结束
```

- `user_text.text` 已由前端 ASR 定稿（非 partial），后端直接入扮演流；空串忽略。
- `generation` 前端单调递增，后端可用作额外防回灌（现有 `currentGeneration` 已足够，字段可选）。

### 2.3 服务端 → 客户端（S→C，全部 JSON 文本帧）

```jsonc
{ "type": "ready" }                                    // 鉴权通过 + 模板校验 + startSession 全部成功; 前端收到后才允许发 user_text
{ "type": "llm_start" }
{ "type": "llm_text", "text": "这阵子…" }            // LLM 增量字幕，可多次；与音频并行到达
{ "type": "llm_done" }                               // LLM 文本已全部发完（音频可能仍在播）

{ "type": "sentence_start", "seq": 1, "text": "这阵子压力确实挺大的。" }  // 可选：一句开始，前端高亮
{ "type": "tts_audio", "seq": 1, "text": "这阵子压力确实挺大的。",
  "mime": "audio/mp3", "audio_base64": "<base64 mp3 完整一句>" }          // 一句完整 mp3，前端排队播
{ "type": "sentence_end", "seq": 1 }

{ "type": "tts_done", "usage": { "characters": 158 } }   // 本轮音频全部下发完
{ "type": "cancelled" }                                  // user_speaking 打断成功（LLM 已 abort、TTS 已 task_cancel）
{ "type": "error", "error": { "code": "...", "message": "...", "retryable": true } }
{ "type": "session_ended", "reason": "user_finish" | "timeout" | "error" }
```

**帧规则**：
0. `ready` 是"可发送"信号：JWT 校验、模板解析、演练登记、`startSession` 全部成功后由服务端主动发一次；前端在收到 `ready` 前不得发 `user_text`（连接已打开但会话可能尚未就绪，避免首条竞态拿到 `unauthorized/not initialized`）。任一前置失败走 `error` + close，不发 `ready`。
1. `llm_text` 与 `tts_audio` 并行：字幕先到、音频随后逐句到，前端各自渲染/排队，互不阻塞。
2. `tts_audio.seq` 从 1 起本轮递增；`text` 为该句字幕（便于前端同步字幕条）；`audio_base64` 为**该句完整可独立播放的 mp3**（§2.5）。
3. `llm_done` 不代表音频播完；以 `tts_done` 作为本轮出声结束信号。
4. 打断回 `cancelled` 后，**不再**下发本轮剩余 `llm_text` / `tts_audio`。

### 2.4 一轮时序（成功）

```
S: ready（鉴权/模板/登记/startSession 全成功, 前端此后才可发 user_text）
C: user_text
S: llm_start
S: llm_text(…) ×N（字幕流）
S: sentence_start(seq=1) → tts_audio(seq=1) → sentence_end(seq=1)
S: sentence_start(seq=2) → tts_audio(seq=2) → sentence_end(seq=2)
S: llm_done
S: tts_done
```

### 2.5 音频封装决策（句级完整 mp3，本期）

- 官方 `task_continued.data.audio` 是 hex mp3 **分片**，一句可能有多片。**后端在服务端按句攒齐**：`sentence_start` 开新句缓冲 → 该句各 `task_continued` 的 hex 解码后 `Buffer.concat` → `sentence_end` 时把整句 mp3 转 base64，发一帧 `tts_audio`。
- **本期不透传 hex 分片、不让前端拼 mp3 帧**：前端 just_audio 直接播完整句 mp3，web/native 都稳；句内分片边到边播的更低延迟后置（§6）。
- `audio_setting.format=mp3`，`sample_rate=32000`，`channel=1`。

### 2.6 打断（barge-in）

1. 处理中（LLM 或 TTS 活跃）收到 `user_speaking` → `llmAbort.abort()` + TTS `task_cancel` → `currentGeneration` 递增防旧流回灌 → 回 `cancelled`。
2. 官方语义：**已下发给前端的音频不撤回**，由前端本地停播丢弃；后端只保证不再下发新帧。
3. `user_speaking` 到达时若无活跃 pipeline，静默忽略（不报错）。
4. **barge-in 触发边界（前端交互已定，后端据此理解）**：仅当「开麦状态下前端 VAD 检测到真实人声开始」才发 `user_speaking`。前端**关麦（静音自己）不发任何打断帧**，AI 继续说完；「点空白提前提交」只用于把本地草稿定稿发 `user_text`，本身不触发打断。后端不要把静音/提交动作误判为打断。

---

## 3. 官方 bidi TTS 重写规格（替换现有 `tts-bidi-client.ts`）

### 3.1 连接

- URL：`wss://api.minimax.cn/ws/v1/t2a_v2_bidi`（由 `MINIMAX_BASE_URL`（`https://api.minimax.cn`）把 scheme 替换为 `wss` 后拼路径，**不要写死域名**）。
- 鉴权：握手头 `Authorization: Bearer ${MINIMAX_API_KEY}`（复用全局 key，**不新增 STT/TTS 独立 key**）。
- 建连后先收 `connected_success`，发 `task_start`，收到 `task_started` 后才能发 `task_continue` / `task_finish`。

### 3.2 `task_start`（发）

```jsonc
{
  "event": "task_start",
  "model": "speech-2.8-turbo",
  "language_boost": "Chinese",
  "voice_setting": { "voice_id": "<env 配置>", "speed": 1.0, "vol": 1.0, "pitch": 0 },
  "audio_setting": { "sample_rate": 32000, "bitrate": 128000, "format": "mp3", "channel": 1 },
  "session_id": "<后端生成，透传回显即可>"
}
```

- `model` 枚举（env `MINIMAX_TTS_MODEL`，默认 `speech-2.8-turbo`）：`speech-2.8-hd | speech-2.8-turbo | speech-2.6-hd | speech-2.6-turbo | speech-02-hd | speech-02-turbo | speech-01-hd | speech-01-turbo`。**不得使用不存在的 `speech-2.8`**。
- `voice_setting`：`voice_id` 必填；`speed∈[0.5,2]`、`vol∈(0,10]`、`pitch∈[-12,12]`；`emotion` 可选（默认让模型自动匹配，本期不强制）。
- `audio_setting`：`format=mp3`；`sample_rate∈{8000,16000,22050,24000,32000,44100}`；`bitrate` 仅 mp3 生效；`channel=1`。

### 3.3 `voice_id` 配置（待联调核实，不臆造）

- 现有 `mandarin_female_001` 未核实，**禁止当可用值上线**。
- 新增 env `MINIMAX_TTS_VOICE_ID`，由后端从官方「系统音色列表」选一个自然中文女声填入（联调时在调试台试听确认）；本期所有 vpt 人物先用同一默认音色，**按人物换音色后置**。

### 3.4 文本上行（发）

- LLM 每个 content chunk → 发 `{ "event": "task_continue", "text": chunk }`，可逐 token 发，**服务端自动攒句**，后端不必自己切句。
- 保留 LLM 原始标点（句末标点决定合成切分，清洗会破坏韵律，禁止删标点）。
- LLM 流结束 → 发 `{ "event": "task_finish" }`（服务端先把缓冲剩余合成完再回 `task_finished` 并关连接，尾句不丢）。
- 多轮对话复用一条连接时，某轮尾句短且无标点：发 `{ "event": "task_flush" }` 催出残留（不关连接）；`task_finish` 会关连接，不能用于多轮催句。本期单轮一连接亦可，但实现按可复用连接写。

### 3.5 服务端事件（收）与翻译

| 官方事件 | 后端处理 |
|----|----|
| `connected_success` | 建连成功，记 session_id |
| `task_started` | 允许发 `task_continue` |
| `sentence_start` | 开新句缓冲，向上游发 `sentence_start{seq,text}` |
| `task_continued` | `data.audio`（hex mp3）解码入当前句缓冲；`is_final` 仅表该请求音频结束；`data.subtitle` 本期忽略 |
| `sentence_end` | 该句缓冲 `Buffer.concat` → base64 → 发 `tts_audio{seq,text,mime,audio_base64}` → 发 `sentence_end` |
| `task_flushed` | 催句完成（多轮用） |
| `task_finished` | 本轮合成结束 → 发 `tts_done{characters: extra_info.usage_characters}` |
| `task_canceled` | 打断确认（配合 `cancelled`） |
| `task_failed` | 关连接，翻译为 `error`（按 §3.7 归一） |

### 3.6 连接池与生命周期（修现有隐患）

- 修正 `tts-bidi-pool.service.ts`：config 正确注入；每轮结束可靠 release；`task_finished`/`task_failed`/异常后释放并允许重建。
- 120s 空闲被服务端以 `2201` 关闭：长静默期由后端按需发 WS ping（服务端不主动 ping），本期单轮短对话可不强保活，出错按可重连处理。

### 3.7 错误归一（base_resp.status_code）

| code | retryable | 处理 |
|----|----|----|
| 0 | — | 正常 |
| 1004 鉴权失败 | false | 不重试，`error` 提示配置/key |
| 1002 / 1039 限流 | true | 退避，本轮可重试 |
| 1001 超时 / 1000 未知 / 5xx | true | 可重连重试 |
| 1042 非法字符>10% | false | 记录并跳过该段，不伪造 |
| 2013 参数异常 | false | 配置/参数问题 |
| 2201 空闲断开 | true | 重连 |
| 2202 非法事件 / 2206 事件顺序 | false | 修协议顺序，不盲目重试 |
| 2204 单条 task_continue >10000 字符 | — | 该条跳过，连接保持 |
| 2205 排队文本过多（非配额限流） | true | 稍后重发该条，**不重连、不重发 task_start** |

---

## 4. vpt 注入与 prompt（沿用 v1.0，仅提示）

- 演练登记（进程内内存 Map，不落库）+ Contributor 优先分支 + `replacesPersona=true` + `script` 7 大块只在服务端读、不下发，全部按 v1.0 §2.2/§2.3 实现。
- 临场参数映射（difficulty/style/emotionBaseline/defenseLevel）按 v1.0 §2.5；`defenseType` 由模板固定，握手不可覆盖。
- LLM 仍走短句、口语化、不给建议、不揭 AI 的硬规则（现有 renderSystemPrompt 约束）。

---

## 5. 明确不做（本期边界，勿扩面）

- 不做麦克风实时流式 ASR / 边说边转（官方 .cn 无此能力，见 §6）；输入走前端 VAD 切段 + 现有文件 ASR。
- 不透传官方 hex 分片、不让前端拼 mp3；不做句内分片边到边播（后置）。
- 不按 vpt 人物切换不同音色（本期统一默认音色）；不做情绪标签注入。
- 不调 `instantiate` 克隆私有副本，不写 `visitor_full_personas` / 信任度 / 档案解锁持久化。
- 本期结束不触发督导评分/报告（沿用现有 endSession 行为即可，督导队列是否保留由后端现状决定，不新增）。
- 不迁移 LLM 到 Anthropic SDK；不做多实例全局限流/Redis；不在公共响应下发 `script`。
- `fullyReal` 本期不做随机扰动；variance/randomSeed 后端不消费。

---

## 6. 为什么本期不做麦克风实时 ASR（事实记录，避免后端误判）

- 国内站 `POST /v1/speech_to_text`（asr-1.0）是**文件接口**：`stream=true` 仅为「文件传完后 SSE 增量吐字」，官方明确**不支持音频流输入、不支持无容器裸 PCM**，调试台注明「不是麦克风实时识别」。
- 真正的 OpenAI-Realtime 风格麦克风 WS（`input_audio_buffer.append`）仅存在于旧 `wss://api.minimax.chat/ws/v1/realtime?model=abab6.5s-chat`（老域名/老模型/未进最新 .cn 文档/订阅覆盖未知），本期不押注。
- 真·逐字实时 ASR 留待后续单独立项（第三方实时 WS ASR 或官方 Realtime 可用时）。

---

## 7. 后端验收场景（自测）

1. **成功出声闭环**：`templateId=vpt_intimate_avoidance_l1&mode=voice` 连接 → 发 `user_text`「你最近怎么样」→ 收 `llm_start` + 增量 `llm_text` + 若干 `tts_audio`（每句完整 base64 mp3，seq 连续）+ `llm_done` + `tts_done`；人物符合主诉与回避防御，口语短句。
2. **逐句到达**：多句回复时 `tts_audio` 按 seq 先后到，前端可逐句播；字幕 `llm_text` 先于/并行于音频。
3. **打断**：出声/生成中发 `user_speaking` → 收 `cancelled`，之后无本轮旧帧；TTS 侧已发 `task_cancel`，LLM 已 abort。
4. **官方协议合规**：WSS 路径 `/ws/v1/t2a_v2_bidi`、纯 JSON 帧、mp3 hex 解码、无 0x01/0x02 二进制帧、模型非 `speech-2.8`、无 `mandarin_female_001`。
5. **错误归一**：1004 不重试；2205 不重连只重发；`task_failed` 翻译为可识别 `error`，不伪造成功音频。
6. **模板不存在**：未上架 `templateId` → `error(template_not_found)` + 关闭，不回退默认。
7. **清理**：disconnect/`session_finish` 后清登记、abort LLM、cancel/释放 TTS 连接，同 sid 重连不串旧设定。
8. **就绪信号**：鉴权/模板/登记/startSession 全成功后先回一帧 `ready`，前端收到前不发 `user_text`；前置失败走 `error`+close，不发 `ready`。
9. **依赖声明**：`ws` 显式写入 `package.json` 的 `dependencies`（不靠 `@nestjs/platform-ws` 传递引入），同步锁文件，保证 `npm ci --omit=dev` 生产安装后不缺包。

---

## 8. 仅剩联调确认（非阻塞）

- `MINIMAX_TTS_VOICE_ID` 具体值：后端在官方系统音色列表/调试台试听后填 env，前端不感知。
- `ageRange` 区间到 `identity.age` 呈现：后端取下限 + content 注明区间，前端不依赖精确年龄。
- `style` 映射不上统一回退 `mixed`。
- web 端 WS 纯 JSON 帧连通性联调实测（本期无二进制帧，天然规避 web 二进制兼容问题）。
