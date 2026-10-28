# 全真语音 vpt · 后端联调待办清单（2026-10-23）

> 配套主稿：`docs/specs/counselor-roleplay-voice-bidi-tts-2026-10-23.md`（v2.1）。
> 本清单只列「代码核对后仍需后端动作 / 联调确认」项；已完成的代码改动不重复。
> 核对方式：**全量**只读扫描 `src/voice/**`、`src/counselor/providers/**`、`src/agent/visitor/**`、`.env`、`package.json`、`typings/global.d.ts`、`app.middleware.ts`。
>
> ⚠️ 上一版清单的扫描范围只写了 `src/voice/**`，因此漏判了一条 —— 见 A 段最后一行。

---

## A. 已完成（代码已核对，无需再动）

| 项 | 落点（核对证据） |
|---|---|
| 官方 bidi TTS 客户端/协议/句攒/错误归一 | `src/voice/tts/tts-bidi-client.ts`、`tts-protocol.config.ts`、`tts-protocol.types.ts`、`tts-error.mapper.ts`、`tts.service.ts` |
| 句级完整 mp3（服务端按句攒齐 → base64 下发） | `tts-bidi-client.ts` `handleSentenceEnd()` → `Buffer.concat` → `sentence_audio{seq,text,mime,data}` |
| `ready` 就绪帧（鉴权/模板/登记/startSession 成功后发） | `voice.gateway.ts:211` `sendJson(client, { type: 'ready' })`；类型见 `voice.types.ts:33` |
| 句级音频与 LLM 流**并行**下发（边生成边出声） | `voice.service.ts` `pumpTtsEvents()` 独立协程，与 `consumeLlmStream()` 并行（非"吃完 LLM 再等 TTS"） |
| barge-in 回 `cancelled` 且不再下发本轮旧帧 | `voice.service.ts` `bargeIn()`（`generation` 递增 + `llmAbort.abort()` + TTS `task_cancel`） |
| 模板不存在 → `template_not_found` + close(1008)，不回退默认 | `voice.gateway.ts` `resolveTemplate()`（查询失败另归 `template_lookup_failed` + close(1011)） |
| `ws` 显式写入 dependencies（不靠传递引入） | `package.json:97` `"ws": "^8.21.3"`；`package-lock.json` 根依赖同步（解析树不变，无需重装） |
| TTS 模型已改 turbo（非不存在的 speech-2.8） | `.env:185` `MINIMAX_TTS_MODEL=speech-2.8-turbo` |
| 上游域名已切国内站 | `.env:148` `MINIMAX_BASE_URL=https://api.minimax.cn` |
| ASR CORS 允许自定义 `language` 请求头 | `app.middleware.ts:73-79` allowedHeaders 含 `'language'` |
| ASR 复用 `POST /counselor/practice/asr`，本期零新增端点 | `src/counselor/providers/practice-asr.service.ts`；已逐项核对官方 ASR 文档（model/response_format/language 头/500s·50MB 上限/错误码映射全一致） |
| **vpt 模板注入 / 演练登记 / replacesPersona / script 不下发** | **本次从零新增**（v1.0 稿声称"已存在"但代码里原本没有）：`voice/voice-session-registry.ts`（演练登记）、`voice/voice-template-slot.ts` + `voice/voice-session.module.ts`（依赖倒置插槽）、`counselor/providers/counselor-visitor-pool-template.resolver.ts`（模板解析）、`counselor/providers/counselor-visitor-context.contributor.ts`（演练登记优先分支，`replacesPersona=true` ×2 处） |
| 握手扩 `templateId` / `mode` / 临场参数 | `voice/voice-handshake.ts`（纯函数：白名单 + 越界裁剪 + 非法回退） |
| **sessionId 改从 query 读取**（`?sessionId=<uuid>`） | `voice/voice-handshake.ts` `parseVoiceHandshake()`：query 优先 → path 正则兜底 → `'default'`。**技术前提已核实**：`@nestjs/platform-ws` 把 `path` 原样传给 `ws`，而 `ws` 的 `shouldHandle` 是精确比较（`pathname !== path` → `abortHandshake(400)`），子路径在 HTTP upgrade 阶段就被拒，进不了 `handleConnection`；且改前 sid 恒为 `'default'` → 会话 Map / 演练登记全部撞同一个 key |
| 纯函数单测（切句标点集 / 握手三态 / 错误码映射 / 端点拼装） | `test/voice/voice-protocol.spec.ts`（`npm test` 覆盖，`test/` 不进 build 产物） |
| env 键登记进 `ProcessEnv`（否则 TS4111） | `typings/global.d.ts`（新增 9 个 TTS 键，删 2 个已废弃键） |

---

## B. 阻塞项（需后端动作 / 配置）

### B-2 WS 网关 path 精确匹配，`/voice/training/<sid>` 子路径握不上手（前端实测暴露）

- **现象**：前端最初连 `ws://localhost:3000/voice/training/<sid>?token=...`，浏览器报 `Failed to connect WebSocket`。
- **实测证据（curl 只读探测）**：
  - `GET /voice/training?token=x`（精确 path）→ `101 Switching Protocols` 握手成功，随后因假 token 回 `error{unauthorized}` 帧并关闭。
  - `GET /voice/training/<sid>?token=x`（带子路径）→ 连接被直接断开（curl exit 52 empty reply），**到不了 `handleConnection`**。
- **根因**：`@nestjs/platform-ws` 的 `@WebSocketGateway({ path: '/voice/training' })`（`voice.gateway.ts:66`）对 path 做**精确匹配**，不吃 `/<sid>` 子路径；而 `extractSessionId()`（`voice-handshake.ts:136-141`）只从 pathname 正则 `/voice/training/([^/]+)` 取 sid，不读 query。两者冲突。
- **前端已改**：`roleplay_ws_client._buildUri()` 不再把 sid 放 path 段，改连 `/voice/training?sessionId=<sid>&token=...&templateId=...`，path 恒定为精确的 `/voice/training`（已 curl 验证 101）。
- **需后端改（一处纯函数）**：`parseVoiceHandshake()` 的 `sessionId` 优先读 query `sessionId`，path 正则仅作兜底：
  ```ts
  sessionId: readOptional(params.get('sessionId')) ?? extractSessionId(parsed.pathname),
  ```
  （`readOptional` 已存在，空/缺省返回 undefined，落到 path 正则；都没有再回 `'default'`。）
- **验收**：`/voice/training?sessionId=<uuid>&token=<valid>&templateId=...` 握手 101 → 鉴权/模板通过后发 `ready`，`data.sessionId` 等于前端传入的 uuid（不再是 `'default'`），`sessions.register` / `startSession` / `handleMessage` / `endSession` 全链路用该 uuid。

### B-1 `MINIMAX_TTS_VOICE_ID` 已填，剩「试听确认」

- 现状：`.env:193` 已填 `Chinese (Mandarin)_Lyrical_Voice` —— **官方文档 task_start 字段说明里公开列出的普通话女声系统音色**，非臆造值（旧的 `mandarin_female_001` 是未核实占位，已彻底不用）。
- 动作：登录官方系统音色列表/调试台**试听**；若音色风格不合适，直接换 `.env` 里的值或 `.env.example` 注释里列的另一个 `Chinese (Mandarin)_HK_Flight_Attendant`。
- 约束（代码已保证，勿绕过）：
  - 空值时 voice 模式 fail-fast 回 `error{code:'tts_config_invalid', retryable:false}`，**不合成出能播但不像人的音频**。
  - 本期所有 vpt 人物统一用这一个默认音色，按人物换音色后置。
- 前端不感知 voice_id，只收 base64 mp3。
- ⚠️ 若该音色对当前账号未开通，上游会返 1004/2013 → 归一为可识别 `error`（`retryable:false`），**不伪造成功音频**。

---

## C. 待联调确认（非阻塞，遇到再处理）

| 项 | 说明 / 处理 |
|---|---|
| C-1 M Plan 订阅是否覆盖 TTS/ASR | 用户账号仅订阅、按量未充值；若上游返 401/402/余额不足，归一为可识别 `error`（retryable 按上游），**不伪造成功音频/文本**。 |
| C-2 `ageRange` 到 `identity.age` | 后端取下限 + content 注明区间；前端不依赖精确年龄。**已实现**（`counselor-visitor-context.contributor.ts` `parseAgeRangeLowerBound()` + 背景段写明区间）。 |
| C-3 `style` 映射不上 | 统一回退 `mixed`，不报错。**已按 spec §2.2/§5.2 实现为三态**：① 合法值→用它；② 映射不上→`mixed`（**不是**模板缺省）；③ 未提供→模板 `styleHint`→兜底 `mixed`。②③ 混用会出现"用户传了乱值却被静默换成模板默认人物"。 |
| C-4 web WS 连通 | 握手 path 问题见 B-2；path 对齐后本期纯 JSON 文本帧、无二进制分片，浏览器实测收发即可。 |
| C-5 `tts_done.usage.characters` | 若上游 `extra_info.usage_characters` 字段名不符，退化为本地统计字符数，不影响出声（`tts-bidi-client.ts` 已实现两级回退）。 |

---

## D. 明确不做（本期边界，勿回流）

- 不做麦克风实时流式 ASR / 边说边转；输入走前端 VAD 切段 + 文件 ASR。
- 不透传官方 hex 分片、不让前端拼 mp3；不做句内分片边到边播（后置）。
- 不按人物换音色、不注入情绪标签；不调 `instantiate` 克隆；本期结束不触发督导评分。
- 不迁移 LLM 到 Anthropic SDK；不做多实例 Redis 全局限流；不在响应下发 `script`。

---

## E. 联调通过判据（对齐主稿 §7，前端视角）

1. 连接收 `ready` 后前端才发 `user_text`。
2. 一轮内 `llm_text` 字幕流 + 逐句 `tts_audio`(seq 连续、base64 完整 mp3) → `llm_done` → `tts_done`。
3. `user_speaking` 打断后回 `cancelled`，且不再下发本轮旧帧。
4. 未上架模板回 `template_not_found` + close(1008)，不回退默认人物。
5. disconnect/`session_finish` 清登记、abort LLM、释放 TTS 连接，同 sid 重连不串设定。

---

## F. 本轮新增的执行动作（留给用户手动跑）

| 动作 | 说明 |
|---|---|
| `npm test` | 跑 `test/voice/voice-protocol.spec.ts`（含"切句标点集与官方逐字一致""切句不丢字""sessionId 三态"三条高价值回归）。**注意**：这是纯函数单测，不连上游、不连 DB。 |
| `npm run build` / `npm run lint` | 上一轮已修完（TS4111 env 声明、7 个 lint 错、`prefer-single-call` 变参 API）。本轮改动后需复跑。 |
| 填音色并试听 | 见 B-1。 |

---

## G. 契约变更与主稿同步（待拍板）

| 项 | 说明 |
|---|---|
| G-1 主稿 §2.1 的握手地址已过期 | 主稿写的是 `WS /voice/training/<sid>?token=***`，但该形式**在传输层就不通**（见 A 段 sessionId 行的技术前提）。现行为：`WS /voice/training?sessionId=<uuid>&token=***&templateId=...`。前端已按新约定改，**后端只改了 `voice-handshake.ts` 一处**（`voice.gateway.ts` / `voice.service.ts` / `voice-session-registry.ts` 都消费 `handshake.sessionId`，自动生效）。主稿 §2.1 是否同步措辞，待拍板。 |
| G-2 旧 path 形式仍兼容 | `extractSessionId()` 保留，存量客户端（`/voice/training/<sid>`）不会立刻断 —— 但它们**连不上**（400），所以只是代码层面的兼容，不是可用性兼容。 |

---

## H. 过程经验（避免重演）

- **输出链路会省略渲染，别拿它当文件真容**：排查中一度看到 `expect(...).…ault');` 这样的行，误判为"文件被粘贴截断"。实际用 `od -c` 取原始字节证明该行**完全正常** —— 是工具输出/错误提示把长片段省略成了 `…`。**判定文件真伪一律以原始字节为准**（`od -c` / `xxd`），不要以渲染后的文本为准。
- **edit 的 oldText 要跟磁盘现状对齐**：本仓文件被外部编辑过（`token=***` → `token=jwt`），我沿用旧锚点导致 edit 报"找不到"；错误提示里的"found"片段恰好被省略，看起来像"文件被改坏了"，其实是锚点不匹配。
- 顺带修掉一个真问题：原「缺 sid 时落到 default」用例写成了 `expect(x)` —— **没有 matcher，等于空跑**（永远不会红）。现已改为真断言，并加了一个"每个 it() 必须含 expect"的结构性自检思路。
