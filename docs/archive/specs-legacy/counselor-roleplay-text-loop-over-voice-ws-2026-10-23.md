# 心塑 App · 全真会谈「纯文字闭环」接入 /voice/training WS（后端开发稿）

> **文档版本**：v1.0（2026-10-23，拍板定稿：本期只做文字闭环，不做语音对语音）
> **文档状态**：后端开发稿（前端并行把 `/training-session-route` 从 mock 改为连 WS + 文字气泡，等本稿就绪后联调）
> **上游来源**：大炮 2026-10-23「全真会谈 `/training-session-route` 前后端扫描，出给后端的完整文档」+ 5 项拍板（见 §0）
> **关联规格**：复用现有 `/voice/training` WS（`ai-voice-training-v0.3.md`）、复用 `counselor/visitor-pool` 公共模板库（`counselor-visitor-pool.md`）、复用 `LlmService.streamChat`；**不新造一条对话链路**。

---

## 0. 元信息与已拍板项

| 项 | 值 |
|----|----|
| 本次主任务（P0） | 从来访池（`visitor_pool_templates`）选一个 `vpt_*` 人物 → 连 `/voice/training` WS → **打字发送** → 后端真 LLM 以该人物身份**流式文字回复** → 前端逐字气泡展示，形成一次可闭环的全真文字演练 |
| 已拍板 ① | **本期只做文字闭环**（打字 ↔ 流式文字气泡），不做语音对语音 |
| 已拍板 ② | ASR 语音识别走**服务端中转**（阶段二预埋，见 §3），废弃现有 `voice/asr-token` 客户端直连占位，本期不接 |
| 已拍板 ③ | **本期只出流式文字气泡，TTS 不出声**（不发音频帧，不启动 TtsService） |
| 已拍板 ④ | 前端收敛为单一状态层，不保留两套打架（后端无需感知，本稿只约束服务端行为） |
| 已拍板 ⑤ | 前端来访池选中的 **`vpt_*` templateId 透传给后端**；完整 7 大块剧本由后端自己从模板表读，前端不下发剧本 |
| 后端现状 | LLM 已真连（`LlmService.streamChat` SSE）；`/voice/training` WS 已有 `user_text → llm_start/llm_text/llm_done` 骨架 + TTS 编排；vpt 公共模板库 + Contributor 插槽已存在；三者尚未接线 |
| 不做什么 | 见 §4「明确不做」 |

---

## 1. 现状扫描（扫描日期 2026-10-23，基于后端代码）

### 1.1 可直接复用的三块现成能力

1. **LLM 已真连**：`src/agent/llm/llm.service.ts` 走 OpenAI 兼容 `POST {MINIMAX_BASE_URL}/v1/chat/completions`，SSE 解析 `choices[0].delta.content`，带指数退避重试、caller signal + 超时 AbortSignal、per-call 可覆盖 model/maxCompletionTokens。env 已配 `MINIMAX_BASE_URL=https://api.minimax.cn`、`MINIMAX_LLM_MODEL=MiniMax-M3.1-Flash`、真实 key。**本期不迁移 Anthropic SDK**（评估项，后置）。
2. **WS 骨架已在**：`src/voice/voice.gateway.ts`（`@WebSocketGateway({path:'/voice/training'})`，path `/voice/training/<sid>?token=<jwt>&personaId=<id>`，JWT 从 query 或 Bearer 头校验）+ `src/voice/voice.service.ts` 的 `onUserText → visitor.streamTurn → 消费 LLM chunk（content 转发 client）→ done`，已带 barge-in（`user_speaking` → abort LLM，`generation` 递增防旧流回灌）。
3. **vpt 模板库 + 注入插槽已在**：
   - `visitor_pool_templates` 公共只读表，17 列，含表层字段（codename/ageRange/presentingComplaint/defenseType/issueDomain/trainingGoal/difficulty/styleHint/emotionBaselineDefault/defenseLevelDefault）+ `script`（7 大块全量剧本 json，公共接口绝不下发）。
   - `agent/visitor/visitor-context.ts` 的 `VisitorContextRegistry` + `VisitorContextContributor` 依赖倒置插槽，`renderSystemPrompt` 支持 `blocks: VisitorContextBlock[]`（content / difficulty / identity / `replacesPersona`），`VisitorService.buildLlmMessages` 每轮 `contextRegistry.resolve(...)` 取块拼进 system prompt。
   - `counselor/providers/counselor-visitor-context.contributor.ts` 已实现并注册该插槽，目前按 sessionId 反查长程 `training_sessions / long_term_case_sessions` 注入人设（反查不到返回 `null`，不影响普通 voice session）。

### 1.2 三块尚未接线的缺口（本期要补）

| 缺口 | 现状 | 本期补法 |
|----|----|----|
| WS 握手不认识 `templateId` | 只提取 `personaId`（指向内存 3 个内置种子），vpt 模板进不来 | query 新增 `templateId` + 纯文字模式与临场参数，服务端登记 sessionId → vpt 设定（§2.2） |
| vpt 剧本没进扮演 prompt | Contributor 只反查长程库；单次演练不落库 → 反查不到 → 回退内置种子 | Contributor 增加「演练登记」优先分支，命中即从模板表读 `script` 拼行为块，`replacesPersona=true`（§2.3） |
| 每轮都启动 TTS 并推音频帧 | `onUserText` 消费 LLM 后推 TTS、发 `tts_start/audio/tts_done` | 纯文字模式跳过 TtsService，只发 llm 系列帧（§2.4） |

### 1.3 本期不复用 / 废弃的占位（仅记录，勿接）

- `src/voice/asr-token/*`（`GET /voice/asr-token` 自签 JWT + 自拼 `/v1/asr/stream` URL）：客户端直连占位，secret env 仍是占位符，未联调。**本期废弃**，阶段二改服务端中转（§3）。
- `src/voice/tts/tts-bidi-client.ts`：早期自拟 bidi 协议帧、`speech-2.8` / `mandarin_female_001` 为占位，未按官方核实。**本期不接通**，出声后置。

---

## 2. P0 · 纯文字闭环（本期主任务）

### 2.1 方案选型（已拍板，无需再问）

| 决策点 | 采用 | 理由 |
|----|----|----|
| 对话链路 | **复用 `/voice/training` WS**，不新开 HTTP 对话端点、不新建第二条链路 | 流式文字天然适合 WS；LLM 流、barge-in、历史滑窗都已在这条链上，新开会重复造 |
| 人物来源 | **query 带 `templateId`，后端从 `visitor_pool_templates` 读剧本**，不调 instantiate 克隆 | 本期是单次零压演练，不需要私有副本/信任度/档案解锁；克隆是重路径，后置到长程 |
| 剧本注入 | **走现有 Contributor 插槽**（新增演练登记优先分支），不在 agent 侧硬编码 counselor | 遵守既有依赖倒置（agent 不 import counselor），长程链不受影响 |
| 出声 | **纯文字模式跳过 TTS** | 拍板③；先把「真人感文字扮演」闭环跑通，TTS 单独排期 |

### 2.2 WS 连接与握手契约（在现有 query 上扩展）

```
WS /voice/training/<sid>?token=<jwt>&templateId=<vpt slug>&mode=text&difficulty=L1&style=cooperative&emotionBaseline=0.35&defenseLevel=0.2&visitorMode=useMySettings
```

- `<sid>`：前端生成的会话 uuid，作为 sessionId（沿用现有 `extractSessionId` 正则 `/\/voice\/training\/([^/?]+)/`）。
- `token`：用户 JWT，鉴权沿用现有 `jwtSecret` 校验，0 改动。
- 新增 query 参数（全部 ASCII / 数值，避免中文与转义；**人物代号/年龄/主诉/剧本一律由后端从模板读，前端不传**）：

| 参数 | 必填 | 取值 | 说明 |
|----|----|----|----|
| `templateId` | 纯文字演练必填 | vpt slug，如 `vpt_intimate_avoidance_l1` | 指向 `visitor_pool_templates.id`；**不传或为空 → 回退现有内置 persona 兜底**（向后兼容，普通 voice session 行为不变） |
| `mode` | 否，默认 `voice` | `text` / `voice` | `text` = 本期纯文字模式：跳过 TTS、不发音频帧；`voice` 保留给未来出声（本期后端可暂不实现 voice 分支，缺省即按 text 对待亦可，但要预留开关） |
| `difficulty` | 否 | `L1` / `L2` / `L3` | 覆盖模板默认难度；缺省用模板 `difficulty` |
| `style` | 否 | 字符串 | 来访者配合风格，映射到后端既有 `VisitorStyle`；**映射不上回退 `mixed`**，不得报错 |
| `emotionBaseline` | 否 | `0.0`–`1.0` | 覆盖模板 `emotionBaselineDefault`；越界（<0/>1）裁剪到 [0,1] |
| `defenseLevel` | 否 | `0.0`–`1.0` | 覆盖模板 `defenseLevelDefault`（**防御水平数值，区别于模板固定不改的防御类型 `defenseType`**）；越界裁剪 |
| `visitorMode` | 否 | `useMySettings` / `fullyReal` | 本期只记录进日志/prompt 备注，**`fullyReal` 本期不做额外随机**（扮演由剧本驱动），后置 |

> 承载方式选 query 而非首帧 JSON：与现有 `personaId` 同范式，连接建立即可登记，不依赖首帧到达顺序；参数全是短 ASCII。

**服务端登记（演练登记，进程内内存 Map）**：连接鉴权通过后，在 `startSession` 同一步把 `{sessionId, userId, tenantId, templateId, preset}` 记入一个内存登记处（可放在 VoiceService 或一个轻量 registry）；`endSession` / disconnect 时清除。登记只供 Contributor 按 sessionId 命中，**不落库**。

**模板校验（连接期）**：`templateId` 非空时，按 `enabled=1 AND deletedAt IS NULL AND id=templateId` 查 `visitor_pool_templates`；查不到 → 回 `error{code:'template_not_found', message, retryable:false}` 并 `close(1008)`，不进默认兜底（避免用户以为选的人物生效了）。

### 2.3 vpt 剧本注入（走 Contributor 插槽）

在现有 `CounselorVisitorContextContributor.build` 中，**先查演练登记，命中则走 vpt 分支；未命中再走现有长程 `loadBySessionId` 反查**（优先级：演练登记 > 长程反查 > 无上下文）。

vpt 分支产出一个 `VisitorContextBlock`：

- `replacesPersona: true`（替换 agent 内置人格画像，避免两套画像并存让模型摇摆，沿用现有做法）。
- `difficulty`：取握手 `preset.difficulty`，缺省用模板 `difficulty`（经现有 `toPersonaDifficulty` 映射 L1/L2/L3）。
- `identity`：`name=模板.codename`；`age` 用模板 `ageRange` 区间呈现（如「28-35」，**不要硬造精确年龄**；`toVisitorIdentity` 若要求 number，后端取区间下限并在 content 里写明「约 28-35 岁」）；`occupation` 从 `script.basics.occupation` 取，缺省留空。
- `content`：复用 `buildVisitorPersonaBehaviorBlock({...})` 渲染：
  - `shallow`：由模板表层 + 握手 preset 组装（name=codename、age=ageRange、complaint=presentingComplaint、visitorStyle=preset.style、emotionBaseline=preset.emotionBaseline、defenseLevel=preset.defenseLevel、background 留空或取 script 概要）。
  - `full`：直接用模板 `script` 7 大块（basics / developmentalTimeline / innerWorkingModel / socialMap / coping / therapyExpectation / presentingIssue）。
  - `trustLevel`：固定 `0.2`（单次演练无信任演进，表面层），`unlockedEntries: []`。

> 模板 `script` 永远只在服务端内部读取，**不随任何公共响应下发**（沿用 `toCard()` 唯一出参转换口的约束）。

### 2.4 消息协议（纯文字模式）

**客户端 → 服务端**（沿用现有联合，本期只用第一项）：

```jsonc
{ "type": "user_text", "text": "你最近怎么样？", "generation": 1 }
{ "type": "user_speaking" }            // 打断当前正在生成的回复（barge-in）
{ "type": "session_finish" }          // 主动结束
```

**服务端 → 客户端（纯文字模式只发这些 JSON 帧，不发 binary 音频）**：

```jsonc
{ "type": "llm_start" }                                   // 本轮回复开始
{ "type": "llm_text", "text": "这阵子…" }                 // 逐字增量片段，可多次
{ "type": "llm_done" }                                   // 本轮回复结束（完整文本已流式发完）
{ "type": "cancelled" }                                  // user_speaking 打断成功，当前流已 abort
{ "type": "error", "error": { "code": "...", "message": "...", "retryable": true } }
{ "type": "session_ended", "reason": "user_finish" | "timeout" | "error" }
```

纯文字模式**明确不发**：`tts_start`、`tts_done`、binary PCM 音频帧；原 `tts_cancelled` 保留给未来出声模式，纯文字打断统一回 `cancelled`（新增通用类型，避免「明明没出声却收到 tts_cancelled」的语义误导）。

**行为规则**：

1. `user_text` → `llm_start` → 逐 chunk `llm_text` → `llm_done`；LLM 参数沿用 `streamTurn`（temperature 0.7、maxTokens 200，短句、口语化，由 `renderSystemPrompt` 硬规则约束单次 ≤50 字）。
2. 生成中收到 `user_speaking` → abort 当前 LLM 流、`generation` 递增防旧 chunk 回灌 → 回 `cancelled`；**纯文字模式无 TTS 可 cancel，不要调用 TtsService.cancel**。
3. `session_finish` 或 disconnect → `endSession`（清内存登记 + memory）。**本期不入督导队列、不生成督导评分**（纯演练无档案，见 §4）。
4. 网络/上游错误沿用现有错误归一化：LLM 5xx/429 → `retryable:true`，鉴权/参数错误 → `retryable:false`，不伪造成功文本。

### 2.5 临场参数到 prompt 的映射口径

| 握手参数 | 进 prompt 的位置 | 缺省/兜底 |
|----|----|----|
| `difficulty` | `block.difficulty` → 行为模式段（L1 开放 / L2 中等阻抗 / L3 高度防御，互斥） | 模板 `difficulty` |
| `style` | shallow.visitorStyle（配合姿态） | `mixed` |
| `emotionBaseline` | shallow.emotionBaseline（内在空洞感起点，不直接说出来） | 模板 `emotionBaselineDefault` |
| `defenseLevel` | shallow.defenseLevel（对「被看穿」的警觉度） | 模板 `defenseLevelDefault` |
| `visitorMode` | 仅记录，本期不改行为 | `useMySettings` |
| 模板 `defenseType`（防御机制类型） | 随 script/行为块固定呈现，**握手不可覆盖** | — |

### 2.6 错误码（在现有 VoiceError 上补充）

| code | retryable | 触发 | 建议动作 |
|----|----|----|----|
| `unauthorized` | false | 缺 token / JWT 失效 | close(1008)（沿用） |
| `template_not_found` | false | `templateId` 非空但查不到已上架模板 | error + close(1008)，不回退默认 |
| `llm_stream_error` | true | 上游 5xx/429/流中断 | 可重连重试本轮 |
| `llm_empty` | false | 上游返回空内容 | `llm_done` 前不发空 `llm_text`，可给一句角色内短句兜底 |
| `gateway_error` | true | 服务端编排异常 | 沿用现有兜底 |

### 2.7 工程要求

- 进程内内存登记即可（单实例）；**不引入 Redis、不改全站限流基建**（多实例全局限流是后续共享基建，见 §3）。
- 登记/ memory 在 `endSession` 与 disconnect 双路径都要清，避免泄漏。
- 纯文字模式不要初始化/引用 TtsService（避免无谓连接与占位 voiceId 干扰）。
- 不改动 `toCard()` 公共出参（剧本不下发的结构性保证保持不变）。
- 保留向后兼容：不带 `templateId` 的普通 voice session，行为与改前完全一致。

### 2.8 验收场景（后端自测）

1. **成功闭环**：带 `templateId=vpt_intimate_avoidance_l1&mode=text` 连接 → 发 `user_text`「你最近怎么样」→ 收到 `llm_start` + 若干 `llm_text`（内容符合该人物「总在关系里先讨好、事后委屈」的主诉与回避防御，口语短句、不揭 AI、不给建议）+ `llm_done`；全程无 `tts_*`、无 binary 帧。
2. **打断**：生成中途发 `user_speaking` → 收 `cancelled`，之后不再收到该轮旧 `llm_text`。
3. **模板不存在**：连一个未上架/不存在的 `templateId` → 收 `error(template_not_found)` 并被关闭，不回退默认人物。
4. **向后兼容**：不带 `templateId` 连接 → 走内置 persona，行为不变；现有长程 sessionId 反查注入不受影响。
5. **清理**：disconnect / `session_finish` 后，登记与 memory 释放（再次以同 sid 连接不串旧设定）。

---

## 3. 阶段二预埋（本期不实现，只留方向，不排期承诺）

- **ASR 服务端中转**：未来客户端把音频（流式或分片上传）发给后端，后端调 MiniMax `/v1/speech_to_text`（国内站 `https://api.minimax.cn`，复用全局 `MINIMAX_BASE_URL` / `MINIMAX_API_KEY`），转写文本作为 `user_text` 入扮演流；**废弃 `voice/asr-token` 客户端直连占位**。届时再定流式 vs 一次性、格式与音量，本稿不锁。
- **TTS 出声**：`mode=voice` 时复用/重接 TtsService，按官方 bidi 协议核实后再开，本期 `speech-2.8` / `mandarin_female_001` 占位值不得当真实可用值上线。
- **多实例全局限流**：当前进程内存储仅单实例精确，跨实例需接 Redis storage（全站共享基建，后续统一做）。
- **LLM SDK 迁移 Anthropic 兼容**：评估项，本期保持 OpenAI 兼容。

---

## 4. 明确不做（本期边界，勿扩面）

- 不做语音对语音、不接实时 ASR 识别、不出声（不发音频帧、不启动 TTS）。
- 不调 `instantiate` 克隆私有副本，不写 `visitor_full_personas` / `training_sessions` / 信任度 / 档案解锁 / 收藏之外的持久化。
- 本期不触发督导评分、不生成督导报告（结束只清会话）。
- 不改 LLM 为 Anthropic SDK、不迁移模型。
- 不做多实例全局限流、不接 Redis。
- 不在公共响应里下发 `script` 7 大块剧本。
- `fullyReal` 本期不做随机扰动；variance / randomSeed 前端保留字段，后端不消费。

---

## 5. 拍板结论与仅剩联调项

### 5.1 已拍板（后端按此实现，无需再问）

1. 复用 `/voice/training` WS，query 带 `templateId` + 纯文字模式 + 临场参数。
2. vpt 剧本走现有 Contributor 插槽，演练登记优先、`replacesPersona=true`，不落库、不克隆。
3. 纯文字模式只发 `llm_start/llm_text/llm_done/cancelled/error/session_ended`，跳过 TTS、不发音频。
4. ASR 服务端中转与 TTS 出声后置，废弃 asr-token 直连占位。

### 5.2 仅剩联调确认（非开发阻塞）

- `ageRange` 区间到 `identity.age`（number 口径）的具体呈现，后端取下限 + content 注明区间即可，前端不依赖精确年龄。
- `style` 字符串到后端既有 `VisitorStyle` 的映射表对不上时统一回退 `mixed`。
- 前端 web 端 WS（标准 RFC6455，纯 JSON 帧）连通性在联调时实测；本期无二进制音频，天然规避 web 二进制兼容问题。
