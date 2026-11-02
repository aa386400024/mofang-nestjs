# 心塑 App · 语音微训练 STT 接入 + LLM 接入方式评估（后端开发稿）

> **文档版本**：v1.2（2026-10-23，拍板定稿：STT 复用全局 env / 全局域名切国内站 / 限流 / 本期不扣配额）
> **文档状态**：后端开发稿（前端已留好提交位，等后端 STT 代理就绪后联调）
> **上游来源**：大炮 2026-10-23「做最重要的语音 STT 真实接入；评估 LLM 是否从 OpenAI 方式改 Anthropic 兼容」+ MiniMax 官方文档（HTTP STT `https://api.minimax.cn/v1/speech_to_text`、Anthropic 兼容 `/anthropic/v1/messages`）
> **关联规格**：`counselor-practice-engine-v1.3-freeform.md` §3.3 提交作答；本文**不改动** §3.3 DTO 与评判链路。
>
> **v1.2 拍板变更（2026-10-23）**：① **推翻 v1.1 的「STT 独立 env」** —— STT 不设任何独立配置位，**全部复用全局** `MINIMAX_BASE_URL` / `MINIMAX_API_KEY`；② **全局 `MINIMAX_BASE_URL` 直接切国内站** `https://api.minimax.cn`（不再保留早期旧入口 `.chat`），LLM / TTS / STT 三条链路同步走该站点，代码兜底默认值一并切 `.cn`；③ 同步清掉代码、配置、注释里 `.chat` / `MINIMAX_STT_*` 的残留；④ 补充 §2.4 表外的错误映射（403 / 404 / 405 / 501 归服务端配置问题）；⑤ 其余拍板（限流 10 次/分钟/用户、只限流不扣配额、两条已知边界接受、Anthropic 试点不排）保持不变。
>
> **v1.1 拍板变更（2026-10-23，已被 v1.2 推翻第 ① 条）**：① STT 用独立 env，**不改动全局 `MINIMAX_BASE_URL`**；② 按量 API Key / M Plan 订阅 Key 都要能配，本期不做双 key 自动切换；③ 限流默认 10 次/分钟/用户、env 可调；④ 本期只限流、不扣会员配额；⑤ 记录两条已知边界（进程内限流、multipart 内存缓冲），本期不动。

---

## 0. 元信息

| 项 | 值 |
|----|----|
| 本次主任务（P0） | 语音微训练 `voiceMetric` 的真实 ASR：录一段 → 转写文本 → 走现有 §3.3 评判 |
| 评估项（非强制，可后置） | LLM 对话接入是否从 OpenAI 兼容切到 Anthropic 兼容（见 §3，**本期不要求全量改**） |
| 后端现状 | 无任何 STT 调用；仅有未验证的 WS ASR token 占位（`voice/asr-token`，见 §1.2）；§3.3 只收文本，不接收音频 |
| 前端现状 | 录音 + 一次性转写提交骨架已完成（web/mobile 双轨，analyze 0 错）：录完调 `POST /counselor/practice/asr` 拿 `text/duration`，再走现有 §3.3 evaluate；等本端点就绪后联调 |
| 不做什么 | 不改 §3.3 `SubmitPracticeAttemptDto`；不落盘存储音频；不做实时流式转写（训练题是「录完一次性转写」）；不在本期全量迁移 LLM SDK |

---

## 1. 现状扫描（扫描日期 2026-10-23，基于后端代码）

### 1.1 语音微训练评判链路（已闭环，缺的只是「文本从哪来」）

- §3.3 `POST /counselor/practice/scenarios/:scenarioId/evaluate` 的 `SubmitPracticeAttemptDto` 只收：
  `submittedText`（ASR 转写文本，允许空串=未识别）、`recordSeconds`（录音秒数，可选，0/缺省=不折算语速）、`durationSeconds`（作答耗时，必填）、`turn`（可选）。
- `PracticeAttemptService.computeSpeechRate` 用 `Array.from(submittedText.trim()).length / recordSeconds * 60` 折算出 `speechRateWpm`；文本为空或无时长 → `null`，只出 ℹ️ 技术提示。
- **服务端不接收音频、不调 ASR**：转写文本应由上游准备好后放进 `submittedText`。

### 1.2 现有 `voice/asr-token`（全真会谈实时流式用途，与本次无关，勿复用）

- `src/voice/asr-token/*`：签发后端自签 JWT（5min）+ 返回 WS URL `/v1/asr/stream`，设计给**全真会谈 WebSocket 实时流式**用。
- 现状问题（仅记录，本次不修）：token 用后端自有 secret 自签、前端 `asr_ws_client.dart` 鉴权头与协议帧为早期占位、`model: speech-2.8` 与官方 HTTP STT 的 `asr-1.0` 不是一回事，**未与官方联调验证**。
- 本次训练题是「录完一次性转写」，走 HTTP 文件转写，**不接这条 WS**。

### 1.3 LLM 现状（评估项背景）

- 链路 2 `src/agent/llm/llm.service.ts`：裸 `fetch` 调 OpenAI 兼容 `{MINIMAX_BASE_URL}/v1/chat/completions`，自解析 SSE（`choices[0].delta.content`），请求体 `messages/stream/temperature/top_p/max_tokens|max_completion_tokens/reasoning_effort`。
- 模型由 env `MINIMAX_LLM_MODEL` 配置（默认 `MiniMax-M3`），counselor 分析链 per-call 覆盖为 `MiniMax-M3.1-Flash` + `reasoning_effort`。
- 多调用方共用：Visitor / Supervisor / counselor 分析 / VoiceService。

---

## 2. P0 · 语音微训练 STT 服务端代理（本次主任务）

### 2.1 方案选型：服务端代理，前端不直连 MiniMax

| 方案 | 结论 | 理由 |
|----|----|----|
| **A. 服务端代理（采用）** | ✅ | `MINIMAX_API_KEY` 永不下发；可统一限流/配额/成本核算/错误映射；移动端不必直连第三方域名；音频不过库（流式转发即弃） |
| B. 前端直连 MiniMax HTTP | ❌ | 会暴露或需下发 API key；移动端 multipart 直连第三方域名、跨域/鉴权/错误处理成本高；无法统一配额 |
| C. 复用现有 `voice/asr-token` WS | ❌ | 那是实时流式协议，且未验证；训练题一次性转写用 WS 是过度设计 |

### 2.2 新端点契约

```
POST /counselor/practice/asr
Content-Type: multipart/form-data
Authorization: Bearer <用户 JWT>   // 复用 JwtAuthGuard，挂在 CounselorPracticeController
```

**请求头**：

| 头 | 必填 | 说明 |
|----|----|----|
| `Authorization` | 是 | 用户 JWT（复用 JwtAuthGuard） |
| `language` | 否 | BCP-47，训练题中文传 `zh`；不传或空=混合语言识别。**注意这是请求头，不是表单字段**；支持 `zh/yue/en/ja/ko/...` |

**请求表单字段（multipart/form-data）**：

| 字段 | 类型 | 必填 | 说明 |
|----|----|----|----|
| `file` | audio 文件 | 是 | 官方支持：`wav/aiff/flac/alac(m4a)/mp3/aac/opus/ogg`；**不支持裸 PCM** |

**响应 `200`**（透传上游 json 结构，`trace_id` 保留下划线原样）：

```json
{
  "text": "听起来你这阵子是真的很累，脑子一直转停不下来。",
  "duration": 12.744,
  "trace_id": "021785229015510a2c883cf675b9804d"
}
```

| 字段 | 类型 | 说明 |
|----|----|----|
| `text` | string | 完整转写文本；未识别到内容时返回空串 `""`（前端据此走「未识别只出技术提示」分支，**不得伪造文本**） |
| `duration` | number | 上游返回的音频时长（秒，计费依据），可作为 `recordSeconds` 的校准值 |
| `trace_id` | string | 上游追踪 ID，落日志便于排查 |

> 前端拿到 `text`/`duration` 后，**仍走现有 §3.3 evaluate 提交**：`submittedText=text`、`recordSeconds≈duration`、`durationSeconds` 照旧本地计时。§3.3 DTO 与评判逻辑 **0 改动**。

### 2.3 上游对接（MiniMax HTTP STT）

- 上游端点（官方国内站）：`POST {MINIMAX_BASE_URL}/v1/speech_to_text`，`multipart/form-data`，Header `Authorization: Bearer ${MINIMAX_API_KEY}`。
- 官方国内 STT 基址为 `https://api.minimax.cn`（`/v1/speech_to_text`，`model=asr-1.0`）；国际站为 `https://api.minimax.io`。**v1.2 起全局 `MINIMAX_BASE_URL` 已切国内站 `.cn`**（不再保留早期旧入口 `.chat`），LLM / TTS / STT 共用这一个基址；代码**只拼 env、不硬编码域名**（代码兜底默认值同为 `.cn`）。
- 表单（multipart/form-data）：
  - `model`：固定 `asr-1.0`
  - `file`：用户音频（流式转发，不落盘）
  - `response_format`：`json`（只取 `text` + `duration`，不需要说话人分离/时间戳，故不用 `verbose_json/srt/vtt`）
- 请求头：`language`（BCP-47，中文传 `zh`，缺省混合识别），**不是表单字段**，透传给上游。
- 音频约束（上游硬限制，超限直接 4xx，服务端应先预检并给出友好错误）：
  - 时长 ≤ **500 秒**，超出返回 `400`，不截断；
  - 大小 ≤ **50 MB**，超出返回 `413`；
  - 建议前端录成单声道 16kHz 或 `mp3/aac/opus` 压缩格式（训练题单段朗读远低于上限）。

#### 2.3.1 STT 复用全局 env（v1.2 拍板，取代 v1.1 的「独立 env」）

| env | 说明 |
|----|----|
| `MINIMAX_BASE_URL` | 全局基址，**LLM / TTS / STT 共用**。v1.2 起切国内站 `https://api.minimax.cn`（国际站 `https://api.minimax.io`）。代码兜底默认值同为 `.cn`。 |
| `MINIMAX_API_KEY` | 全局 key，**LLM / TTS / STT 共用**。key 类型不写死：按量 API Key 与 M Plan 订阅 Key 都可填，见 §2.3.2。 |

> **不设 `MINIMAX_STT_BASE_URL` / `MINIMAX_STT_API_KEY`**：STT 与 LLM/TTS 是同一个上游，多一层「专用配置位」只会制造「改了 STT 忘了改 LLM」或反之的双份事实源；域名统一切 `.cn` 之后，更没有「站点要分开」的诉求。
> STT 侧**自己的运营参数**仍独立可配（与上游地址无关）：`MINIMAX_ASR_TIMEOUT_MS`（转写超时，与 LLM 超时隔离）、`MINIMAX_ASR_MAX_FILE_BYTES` / `MINIMAX_ASR_MAX_DURATION_SEC`（本地更严的体积 / 时长上限，默认与上游一致）、`PRACTICE_ASR_RATE_LIMIT_PER_MINUTE` / `PRACTICE_ASR_RATE_LIMIT_WINDOW_MS`（限流阈值，见 §2.5）。

#### 2.3.2 按量 / M Plan 订阅两种 key 都要能配（v1.1）

- MiniMax 按量 API Key（接口密钥）与 M Plan（Token Plan）订阅 Key **相互独立、不可互换**；本服务端不写死 key 类型，全局 `MINIMAX_API_KEY` 填哪一种都应能发起调用，由部署环境按实际账户填写。
- **本期不做双 key 自动故障切换/回退**：ASR（speech_to_text）按音频时长单独按量计费，是否计入订阅 token 配额官方未明确，需控制台实测；确认计费归属后再决定是否加「主 key 失败→备用 key」逻辑（届时才引入独立配置位）。
- **账号现状（大炮 2026-10-23）**：当前账号只有 M Plan 订阅、**按量未充值**。若实测订阅 key 调不通 ASR（返回无权限/余额类错误），需先在按量侧充值，再填按量 key；该情况按 §2.4 的 401/402 错误映射返回，不要伪造识别成功。

### 2.4 错误码映射（上游 OaiError → 统一业务错误）

上游错误体为 OpenAI 风格：`{ type:"error", error:{ type, message, http_code }, request_id }`。

| 上游 HTTP | `error.type` | 含义 | 本端点对前端 |
|----|----|----|----|
| 400 | `bad_request_error` | 参数错/超 500s/格式不支持 | 400，文案「音频格式或时长不支持，请重新录一段」 |
| 401 | `authorized_error` | 上游 key 失效（服务端配置问题） | 502/500，记 error 日志，前端「转写服务暂不可用，稍后再试」 |
| 402 | `insufficient_balance_error` | 上游余额不足 | 502，告警日志，前端「转写服务暂不可用」 |
| 413 | `invalid_request_error` | 超 50MB | 413，文案「音频过大，请缩短后重试」 |
| 422 | `unprocessable_entity_error` | 内容敏感 | 422，文案「未识别到有效语音，请再试一次」（不回显敏感细节） |
| 429 | `rate_limit_error` | 限流 | 429，可重试，前端「太频繁了，稍等几秒再试」 |
| 500 | `server_error` | 上游故障 | 502，可重试 |

> **表外的补充映射（v1.2 落地）**：上游 `403`（key 无权限）、`404`（基址没有该端点 / 站点未开通该 API）、`405` / `501` 一律归为**服务端配置问题** → `502`「转写服务暂不可用，稍后再试」，**不得**报成「音频格式或时长不支持」——那会把服务端的锅甩给用户去反复重录。其余未收录的 4xx 同样按 502 处理（宁可报「服务不可用」、让前端保留本地兜底，也不要误导用户重录）。
>
> 服务端把上游 401/402/403 统一归 502，也是 §2.3.2 的直接要求：当前账号只有 M Plan 订阅、按量未充值，这种情况下「订阅 key 调不通 ASR」是**部署配置问题**，不是用户操作问题。

- 网络超时/断连：返回可重试错误，前端保留「先按本地参考回应过一遍」的零压兜底，**不伪装成识别成功**。

### 2.5 工程要求

- **不落盘**：音频从 multipart 直接转发上游，处理完即释放，不写本地磁盘/对象存储（隐私：练习音频不留存）。
- **限流（v1.2 拍板）**：复用 `@nestjs/throttler`，按 **userId** 限制，默认 **10 次/分钟/用户**，阈值走 env 可调（`PRACTICE_ASR_RATE_LIMIT_PER_MINUTE`，窗口 `PRACTICE_ASR_RATE_LIMIT_WINDOW_MS`，默认 60000ms；实测重录偏紧可上调到 15–20，不改代码）。按 userId 而非 IP，避免 NAT 互挤、换 IP 绕过。
- **配额（v1.2 拍板）**：本期**只限流、不扣会员配额**。`QuotaType` 暂无"语音转写"类，`BillingService.consumeQuota` 在 NONE 档会直接抛错，本期不接；用量日志（userId、duration、trace_id、耗时）照记，不记录音频内容，等会员档位体系落地后再加对应 QuotaType。
- **超时**：上游转写超时单独设置（`MINIMAX_ASR_TIMEOUT_MS`，默认 30s），与 LLM 超时隔离。
- **本地体积 / 时长上限**：`MINIMAX_ASR_MAX_FILE_BYTES`（默认 50 MiB）/ `MINIMAX_ASR_MAX_DURATION_SEC`（默认 500s），默认与上游硬限制一致；本地可以调得更严（只会更早拦截，不会放过上游会拒的文件）。
- **可观测**：Pino 记录 `trace_id`、上游耗时、错误类型；失败计数便于排查。
- **反双胞胎**：不复用 `voice/asr-token` 的 WS 签发逻辑；不新建独立 LLM 客户端；STT 与 TTS（`voice/tts`）互不耦合。

#### 2.5.1 已知边界（本期接受，记为后续项，不擅自动）

- **throttler 进程内存储**：当前为进程内限流，多实例部署时是"每实例"而非全局；userId 维度已解决 NAT 互挤与换 IP 绕过，跨实例精确限流等给 throttler 接 Redis storage 时统一处理（属全站共享基建，本期不改）。
- **multipart 内存缓冲**：音频走内存缓冲（≤50MiB，限流兜底），非端到端流式；训练题单段朗读量级无压力，真到 50MiB 级流量再上 busboy 直转。

### 2.6 验收场景（后端自测）

1. 上传一段清晰中文朗读 mp3 → 200，`text` 为对应文字、`duration>0`、带 `trace_id`。
2. 空音频/静音 → `text=""`，不报错、不伪造。
3. 伪造/超限文件 → 命中 §2.4 对应错误码与文案。
4. 上游 429/500 → 返回可重试错误，不崩溃。
5. 音频不落盘：请求结束后临时目录无残留。

---

## 3. 评估项（非本期强制）· LLM：OpenAI 兼容 vs Anthropic 兼容

> 结论先行：**本期不建议全量迁移**。当前纯文本流式对话在 OpenAI 兼容下无功能缺失；Anthropic 兼容可作为「counselor 分析链」单点试点，验证后再评估推广。理由与约束如下，供后端与大炮决策。

### 3.1 官方事实（来自 MiniMax Anthropic 兼容文档）

- 接入：`ANTHROPIC_BASE_URL=https://api.minimax.cn/anthropic`，Node `npm i @anthropic-ai/sdk`，`client.messages.create(...)`；裸 HTTP 为 `POST /anthropic/v1/messages`。
- **仅支持 `MiniMax-M3.1-Flash` / `MiniMax-M3` 两个模型**；其它模型（M2.x 等）必须走标准/OpenAI 接口，不能一刀切。
- 被忽略参数：`temperature`、`top_p`、`top_k`、`stop_sequences`、`mcp_servers`、`context_management`、`container`（M3.1/M3 温度固定 1、top_p 固定 0.95）。
- Thinking：M3.1-Flash **强制开启 thinking**，传 `disabled` 返回 400；M3 默认关闭、可 `adaptive` 开；多轮须把完整 `response.content`（含 thinking/text/tool_use 块）原样回带。
- 差异点（迁移成本）：请求体 `system` 独立字段、content blocks 结构、tool_use/tool_result；SSE 事件为 `content_block_start / content_block_delta(text_delta/thinking_delta)`，与现有 `choices[0].delta.content` 解析完全不同。

### 3.2 建议

| 选项 | 适用 | 建议 |
|----|----|----|
| 维持 OpenAI 兼容（现状） | Visitor/Supervisor/Voice 等多调用方、可能含 M2.x | ✅ 本期保持，零回归 |
| Anthropic 兼容单点试点 | 已是 M3.1-Flash 的 counselor 分析链（要 thinking 深度/规范 tool_use） | 🟡 可单独立项试点，隔离在一条链路，验证 thinking 流与多轮回带后再议推广 |
| 全量切 Anthropic | — | ❌ 本期不做：重写 SSE 解析+请求体、M2.x 不支持、多调用方回归面大、收益不抵成本 |

> TTS、STT 与 LLM 接入方式无关，本次不动。

---

## 4. 明确不做（本期边界）

- 不改 §3.3 `SubmitPracticeAttemptDto` 与 `computeSpeechRate` 语速折算。
- 不做实时流式 ASR、不做说话人分离/字幕（`verbose_json/srt/vtt` 不用）。
- 不落盘/不转存练习音频，不做音频历史回看。
- 不全量迁移 LLM 到 Anthropic SDK；不动 TTS bidi。
- 不修复/不复用现有 `voice/asr-token` WS 占位（另立任务）。

## 5. 拍板结论与仅剩实测项

### 5.1 已拍板（后端按此实现，无需再问）

1. 端点挂 `POST /counselor/practice/asr`，复用 JwtAuthGuard。
2. STT **不设独立 env**，全部复用全局 `MINIMAX_BASE_URL` / `MINIMAX_API_KEY`；全局基址**直接切国内站** `https://api.minimax.cn`（代码兜底默认值同步为 `.cn`），LLM / TTS / STT 共用。
3. 按量 / M Plan 订阅两种 key 都可配（复用全局 key），本期不做双 key 自动切换。
4. 限流默认 10 次/分钟/用户（env 可调，按 userId）。
5. 本期只限流、不扣会员配额，用量日志照记。
6. 两条已知边界（进程内限流、multipart 内存缓冲）接受，本期不动。
7. Anthropic 试点本期不排（见 §3）。

### 5.2 仅剩需运行时实测（非开发阻塞）

- 当前账号仅 M Plan 订阅、按量未充值：用全局 `MINIMAX_API_KEY` 实发一次 `/v1/speech_to_text`，确认是否被接受；若返回 401 / 402 / 403，需按量充值后换按量 key，错误按 §2.4 映射（统一 502「转写服务暂不可用」），不伪造成功。
- 前端骨架已就绪，后端端点就绪后联调：录一段清晰中文 → 200 返回 `text/duration/trace_id` → 前端把 `text` 走现有 §3.3 evaluate。
