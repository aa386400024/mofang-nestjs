# AF-396（承接 AF-395 / AF-394）· 引擎调试三模型 TTS 接入与零成本治理

- 任务：AF-396（AF-395 因 scope 缺 `.env.example` 被取消，AF-396 承接；AF-394 此前已 canceled/archived）
- 分支：`task/AF-396-debug-tts-zero-cost`
- 基线：`b58d64cf958ad83dcc775b9633d25382ba4e95ec`
- 日期：2026-11-24

## 一、交付范围

本轮只改引擎调试页与调试专用后端模块，不碰 Flutter，不改生产 `src/voice` 链路，`src/engine-core` 一行未动。

新增：

- `src/admin-debug/tts/debug-tts.controller.ts`
- `src/admin-debug/tts/debug-tts.dto.ts`
- `src/admin-debug/tts/debug-tts.service.ts`
- `src/admin-debug/tts/debug-tts.providers.ts`
- `src/admin-debug/tts/admin-debug-tts-render.entity.ts`
- `src/migration/1714900000051-CreateAdminDebugTtsRenders.ts`
- `test/admin-debug/debug-tts.spec.ts`

修改：

- `src/admin-debug/admin-debug-chat.module.ts`：注册 TTS 实体、控制器、服务与基础认证中间件。
- `src/migration/index.ts`、`bin/ormconfig.ts`：登记迁移。
- `src/config/envs/default.ts`、`src/agent/llm/llm.service.ts`：MiniMax `include_usage` 显式开关，默认关闭。
- `test/agent/llm-doubao-usage.spec.ts`：补 MiniMax 显式开启 usage 的用例。
- `admin-dashboard/src/views/AutoPractice.vue`、`admin-dashboard/src/api/client.ts`：来访者气泡三模型语音按钮与回放状态。

## 二、TTS 设计

### 2.1 入口与安全边界

- 路由：`POST /admin/api/debug/tts/render`，挂 `AdminRoleGuard`，由 `AdminBasicAuthMiddleware` 覆盖。
- DTO 只接受 `source`、`sessionId`、`turnIndex`、`provider`，**不接受前端自由文本**。文本由服务端从真实会话或落盘逐字稿解析，调试接口不会变成通用 TTS 代理。
- API key 只在服务端环境变量；日志只记 provider、字符数、字节数、缓存命中，不记文本、音频、key。
- 单轮文本超过 1000 字符直接 400，不做拆分合成。

### 2.2 文本来源

- 自动对练：优先 `ap_practice_turns` 的 `visitor_tts_text` / `visitor_display_text` / `visitor_semantic_json`；老场次没有 turn 行时回退 `ap_practice_sessions.debug_session_id` 对应的 `data/debug-sessions/<id>.json`。
- 手动调试：读 `DebugSessionService.getPersistedSession()` 的 `messages`，取该轮 `role='visitor'` 文本。
- MiniMax 使用 `visitor_tts_text`（保留语义标记）；豆包使用 `visitor_display_text`，语义情绪映射为 `context_texts` 语音指令。

### 2.3 三家适配

| provider              | 模型                  | 音色来源                                                                              | 文本/情绪                                                                     |
| --------------------- | --------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `minimax-hd`          | `speech-2.8-hd`       | `MINIMAX_TTS_VOICE_ID` → `MINIMAX_TTS_DEFAULT_VOICE` → `Chinese (Mandarin)_Warm_Girl` | `visitor_tts_text`；`calm` 映射 MiniMax `neutral`，不支持的语义情绪不传       |
| `minimax-turbo`       | `speech-2.8-turbo`    | 同上                                                                                  | 同上                                                                          |
| `doubao-seed-tts-2.0` | `doubao-seed-tts-2.0` | `ARK_AGENT_PLAN_TTS_SPEAKER`，默认 `zh_female_vv_uranus_bigtts`                       | `visitor_display_text`；`sad/calm/fearful/angry/happy` 转豆包 `context_texts` |

- MiniMax 端点 `{MINIMAX_BASE_URL}/v1/t2a_v2`，Bearer 鉴权，返回 `data.audio` 按 hex 解码，兼容 base64。
- 豆包端点 `https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional`，头 `X-Api-Key`、`X-Api-Resource-Id: seed-tts-2.0`、`X-Api-Request-Id`、`X-Control-Require-Usage-Tokens-Return: *`；按行解析 chunked JSON，拼接 `data` base64，接受 `code=0` 与 `code=20000000`。
- 历史环境里的 `mandarin_female_001` 在 2.8 系列会返回 `2054 voice id not exist`，调试模块做了旧 id 到 `Chinese (Mandarin)_Warm_Girl` 的兼容映射；角色音色后续由用户制作后按 provider 映射接入。

### 2.4 缓存

- 表 `admin_debug_tts_renders`，唯一键 `source_type + source_id + turn_index + provider + request_hash`。
- `request_hash` 覆盖 provider、音色、模型、实际文本、情绪、speed、volume、pitch、sampleRate。文本或参数变化会生成新音频，不冒充旧缓存。
- 第二次点击同一会话同一轮同一模型直接命中数据库，不重复调上游；并发双击遇到唯一键冲突会重读缓存，避免重复计费。
- 前端 `ttsStates` 只缓存当前页面 data URL；刷新后首次点击仍会请求后端，但后端命中数据库，不产生上游费用。

### 2.5 前端交互

- `AutoPractice.vue` 的 AI 来访者气泡工具区新增 `HD` / `Turbo` / `豆包` 三个按钮，只在 `msg.role === 'visitor'` 出现；外层工具区保持 `opacity-0 group-hover:opacity-100`，hover 才显示，不预取。
- 点击才调用；loading 显示 `··`，播放中 `■`，错误 `!` 并 toast。全局只保留一个 `Audio`，切换会话或模型时停止播放，`onUnmounted` 清理。

## 三、迁移与真实验证

### 3.1 迁移

`pnpm migration:run` 已执行，输出确认：

- 90 个迁移中 89 个已在库，1 个新增执行。
- `CreateAdminDebugTtsRenders1714900000051` 执行成功并写入 `migrations`。
- 表 `admin_debug_tts_renders` 已创建，含 `MEDIUMBLOB audio`、唯一键、查询索引。

### 3.2 MiniMax 真实试打

使用账户现有 `MINIMAX_API_KEY`，文本“你好，我是来访者。”，音色 `male-qn-qingse`，24kHz MP3：

- `speech-2.8-hd`：HTTP 200，`base_resp.status_code=0`，36,468 bytes，`audio_length=2184ms`，`usage_characters=16`。
- `speech-2.8-turbo`：HTTP 200，`base_resp.status_code=0`，36,468 bytes，`audio_length=2184ms`，`usage_characters=16`。

结论：两条 MiniMax 通道可用，响应结构与缓存落库字段匹配。

### 3.3 豆包真实试打

按官方 Agent Plan 语音 HTTP 接口试打“你好”：

- HTTP 200，响应 JSON `code=45000030`，`message` 含 `AgentPlanDeductNotEnabled`，并提示 `403 Forbidden.AgentPlanDeductNotEnabled`。
- 接口路径、请求头、body 结构可用，真实合成被账户侧 Agent Plan 抵扣开关阻塞。
- 未降级到普通方舟 API token；需在火山方舟控制台开启 Agent Plan 抵扣后重试。

## 四、三个零成本治理

### 4.1 MiniMax `include_usage`：已完成

- `src/config/envs/default.ts` 增加 `minimax.llmIncludeUsage`，仅 `MINIMAX_LLM_INCLUDE_USAGE=true` 时开启，默认 false。
- `LlmService` 只在 MiniMax 且显式开启时下发 `stream_options.include_usage=true`；豆包原有行为不变。
- `test/agent/llm-doubao-usage.spec.ts` 4 个用例全绿，覆盖默认不带、显式开启带。

### 4.2 编排回执误报：未在本任务修复，已拆到 AF-396

- `scripts/orchestration/cli.mjs` 的 `printOperationalHealth()` 直接遍历 `runtime.tasks` 统计 `receiptErrors`，没有过滤已归档/已取消任务，AF-382、AF-389 的陈旧告警持续显示。
- AF-395 scope 不含 `scripts/`，executor 角色卡也不含 `scripts/`；强行塞入会再次触发 `scope-domain-conflict`。
- 因此本任务不修脚本，另开 orchestrator 任务 AF-396 处理；AF-395 交付记录只登记事实，不冒充已修复。

### 4.3 `zero_motion`：静态根因已定位到“事件层全 neutral + 数据本地缺失”，未改 prompt

最新批次 `hRW4V44-t43yyty_EyLke` 共 48 场，`metrics_json.zeroMotionBreakdown = {total:8, closure:0, idle:8}`。

按源码同口径（八个追踪维度 `trust/safety/bond/valence/arousal/resistanceVerbal/resistanceDepth/resistanceStyle` 首末快照全等，且所有 `eventTags` 只有 `neutral`）在本地 `data/debug-sessions` 重算：

- 本地只有 11/48 份逐字稿，37 份缺失，无法逐场复现全部 8 场。
- 11 场中命中 1 场：`488ilfS6J8QrS_Djsdd9R`，`vpt_grief_avoidance_l1`，`cold`，14 轮，`natural_close`，`crisis_outcome=none`，`eventTags` 仅 `neutral`。
- 该场首末八维完全相等：`trust=0.25`、`safety=0.25`、`bond=0.2`、`valence=-0.55`、`arousal=0.35`、`resistanceVerbal=0.55`、`resistanceDepth=0.5`、`resistanceStyle=0.5`。

结论：

1. `idle` 的判定不是 BDI 计算错误，而是**事件层全程 neutral 导致认知增量恒为 0**；`closure=0` 说明 8 场都没有任何非 neutral 事件可豁免。
2. 现有批次指标没有持久化零变化场次的 sessionId，且逐字稿只存在部分机器，导致 7 场无法在本地逐场定位。这本身是可观测性缺口。
3. 不改 prompt、不改 `engine-core` 的前提下无法安全验证“事件分类器为什么全 neutral”；需要真实模型付费批次复跑，登记为后续批次，不在本任务擅自执行。

## 五、闸门与验证

已完成：

- `pnpm exec vitest run test/config/wp25-env-example-coverage.spec.ts test/admin-debug/debug-tts.spec.ts test/agent/llm-doubao-usage.spec.ts`：3 文件 / 20 用例全绿（含 env 模板 12 例）。
- `pnpm test`：312 passed / 1 skipped（313 文件），4757 passed / 4 skipped（4761 用例）。
- `pnpm lint`：exit 0，0 error。
- `pnpm typecheck`：exit 0，0 error。
- `admin-dashboard` `pnpm type-check`：exit 0。
- `pnpm migration:run`：新增迁移执行成功。
- `git diff --stat HEAD -- src/engine-core`：空。

`.env.example` 新增的五个键已过 env 模板契约：`ARK_AGENT_PLAN_API_KEY`、`ARK_AGENT_PLAN_TTS_BASE_URL`、`ARK_AGENT_PLAN_TTS_SPEAKER`、`MINIMAX_LLM_INCLUDE_USAGE`、`MINIMAX_TTS_DEFAULT_VOICE`。

## 六、偏差与遗留

- AF-396 承接 AF-395：AF-395 实现完成后发现 scope 未包含根目录 `.env.example`，补 env 模板会被 preflight 判越界；AF-395 已 `task cancel` 归档，代码提交 `850e3a85` 以 cherry-pick 方式带入 AF-396 分支，未丢失实现。
- AF-394 因 scope 跨 `scripts/` 与 `src/` 无法由单一角色覆盖，此前已被重签发；本任务 `priorTasks` 保留 AF-395 / AF-394 审计链。
- AF-394 记录包 manifest 的 `taskSheet.sha256` 与冻结任务单实际字节不一致（重签发后哈希漂移，任务单正文未改）。已把 manifest 哈希校准到实际任务单字节，并在本轮一起提交；状态索引与事件链未手工改动。
- 编排回执误报修复转 AF-397（orchestrator 角色，scope 含 `scripts/orchestration/`）。
- `zero_motion` 逐场定位需要补齐逐字稿归档或把零变化 sessionId 写入批次指标，登记后续任务。
- 豆包真实对比等待用户在火山方舟控制台开启 Agent Plan 抵扣。
- 角色音色映射待用户制作音色后接入；当前只走各 provider 默认/环境变量音色。

## 七、提交信息

`feat(af396): 接入调试页三模型 TTS 并补齐 env 模板与零成本治理`
