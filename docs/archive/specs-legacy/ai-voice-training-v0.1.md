# AI 语音训练系统 SPEC v0.1

> 心塑 App · 心理咨询师端 · AI 语音模拟训练系统
> 版本: v0.1 (2026-10-08 起, 待 V0.2 SPEC 化 PLAN)
> 状态: **DRAFT · 待用户确认后进入 PLAN 阶段**
> 落盘: `docs/specs/ai-voice-training-v0.1.md`

---

## 0. 文档元信息

| 项 | 值 |
|----|----|
| 项目 | 心塑 App (xin_su_app · counselor 端) |
| 后端 | mofang-nestjs (NestJS 11 · TypeORM · MySQL) |
| 前端 | xin_su_app (Flutter 3.x · Android/iOS/Web) |
| AI 供应商 | MiniMax (speech 2.8 ASR/TTS + m3 LLM) |
| 嵌入模型 | bge-large-zh-v1.5 (自托管 TEI) / chatanywhere 3-small (fallback) |
| 向量库 | **Qdrant** (自托管, 同京东云 ECS, 0 边际成本) |
| Embedding 凭证 | 用户已提供 2 个 chatanywhere key, 见 §14 |
| 鸿蒙 | **不实现** (V0.x 暂缓, 后期议) |
| 鉴权 | 复用现有 `mofang-nestjs/src/auth` (JWT · Passport · JwtAuthGuard) |
| 多租户 | **原生支持** — 扩展现有 User entity 加 `tenantId` 字段, V0.x 默认 `tenantId = uid` (每人自营), V1.x 接 Tenant 实体支持多组织 |
| 目标 | 12 周内交付 MVP (Phase 1-5) |

---

## 1. 背景与目标

### 1.1 背景
心理咨询师培训依赖大量"模拟来访者"扮演, 传统方式靠学员互扮或聘请演员, 成本高、规模受限、效率低。心塑 App 引入 AI 模拟来访者, 让学员随时可练、错误可被即时纠正、表现可被长期追踪。

### 1.2 目标
- **企业级实时 AI 语音训练**: 来访者 AI 拟真度高, 情绪表达丰富, 支持打断/沉默等真实对话行为
- **督导闭环**: 训练后自动生成督导报告, 错误模式沉淀, 越练越准
- **企业级知识库**: 内容可控、可追溯、可多人协作, 含 CMS 编辑界面
- **商业化就绪**: 会员/次数包模型, 计费准确, 配额可控

### 1.3 关键成功指标
- 训练 session 首响 < 1s (打断恢复 < 400ms)
- 单 session 成本 < 5 元 (含 ASR + TTS + LLM)
- 内容冷启动: 200+ 案例 + 60+ 督导标准 + 100+ 知识点
- 督导报告可用率 > 90% (用户主观评分)

---

## 2. 范围 (Scope)

### 2.1 In Scope
- AI 模拟来访者实时语音对话 (V1-L1/L2/L3 三档难度)
- 用户语音 → 文字 (ASR) + 情绪识别
- AI 文字 → 语音 (TTS, 多情绪, 文本内嵌 tag)
- 多 Agent 系统: Visitor (实时) + Supervisor (离线)
- 督导报告生成 (评分 + 逐句标注 + 错误模式 + 成长建议)
- 报告自动回写 RAG 知识库 (错误模式自我进化)
- 企业级知识库 + CMS (内容编辑 / 工作流 / 版本 / RBAC / 全文搜索 / 定时发布 / 实时预览)
- 多租户架构 (原生支持) — 扩展现有 User entity 加 `tenantId` 字段, V0.x 默认 `tenantId = uid` (每人自营), V1.x 接 Tenant 实体支持 B 端组织接入
- 商业化: 会员 (包月) + 次数包 + 单次 (体验)
- 计费 / 限流 / 配额
- 可观测性 (Pino + Prometheus + OpenTelemetry)
- 合规: 等保备案 + 录音授权 + 30 天自动清理

### 2.2 Out of Scope (V0.x)
- 鸿蒙 (HarmonyOS NEXT) 端
- 多语言 (仅中文, V0.x 锁定 zh-CN)
- 离线 ASR/TTS (云端依赖, 离线场景降级为文字模式)
- 真实来电/电话功能 (仅 App 内训练)
- 心理健康诊断 (本系统是**训练工具**, 不是诊断工具)
- 视频通话 (V0.x 仅语音, 视频后期 V1.x 议)
- 多 Agent 同时在训 (Visitor 是单人对话, 暂不支持群组训练)

---

## 3. 假设 (Assumptions)

| # | 假设 | 影响 | 验证方式 |
|---|------|------|----------|
| A1 | MiniMax m3 LLM 有合理 SLA (99.5%+) 和 streaming 支持 | 实时对话质量 | MiniMax 商业合同 / 实测 |
| A2 | MiniMax speech 2.8 first byte < 300ms | 首响 < 1s 可达 | 实测 (Phase 1 必跑) |
| A3 | MiniMax bidi `task_cancel` 在生产稳定 | 打断体验 | Phase 3 实测 |
| A4 | 用户在京东云, 至少 4C8G ECS × 2 (bge + NestJS) | 自托管能力 | 用户确认 |
| A5 | 用户已开通 chatanywhere 账号 (2 个 key: 1 标准 + 1 m plan) | Embedding 兜底 | 用户已提供 |
| A6 | Qdrant 自托管 (同京东云 ECS) — 等保责任走 ECS 整体备案, 不单独考 | 合规 | 用户确认 |
| A7 | 4G/5G 网络在中国大陆平均延迟 < 100ms | 实时对话可达 | 实测 |
| A8 | 用户已接受"训练录音本地存 + ASR 文本本地存, 不上云"的设计 | 合规底线 | 用户已确认 (从历史 SPEC) |
| A9 | 现有 `User` entity (uid/phone/email/passwordHash/state) 扩展 `tenantId` 字段, 单条 migration + backfill 即可完成, 不破坏现有用户体系 | 多租户实现路径 | 用户已确认 (xinsu 已有登录) |

> ⚠️ 假设 A1-A3, A6 待用户在 SPEC review 时正式确认 (见 §23)。

---

## 4. 非目标 (Non-Goals)

- 不做"通用心理咨询 AI 助手" — 只做训练场景
- 不替代真人咨询师 — 是工具, 不是替代品
- 不做"自我对话"模式 — 必须有 AI 来访者 + 用户咨询师的双角色
- 不做开放式闲聊 — 必须挂载在固定 persona + 场景
- 不做实时多用户协同 — 单人训练
- 不做语音生物特征识别 — 不收集声纹做身份认证 (合规)
- 不做儿童心理咨询训练 — 仅成人心理咨询

---

## 5. 架构总览

### 5.1 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│  Flutter Client (Android / iOS / Web)                         │
│  ┌──────────────────┐  ┌────────────────────────────────┐  │
│  │ Audio I/O        │→│ VAD + Barge-in 控制器           │  │
│  │ (record          │  │  - Silero VAD ONNX (client)    │  │
│  │  + just_audio    │  │  - 情绪特征提取 (可选)          │  │
│  │  + flutter_webrtc│  └─────────────┬──────────────────┘  │
│  │   audio processing)│               │                     │
│  └──────────────────┘               ↓                     │
│                       ┌──────────────────────────────┐     │
│                       │ WebSocket 客户端 (2 通道)      │     │
│                       │  ├ Ch1: NestJS Control WS     │     │
│                       │  │   (信令 + LLM 文本转发)     │     │
│                       │  └ Ch2: MiniMax ASR WS        │     │
│                       │     (客户端直连, 短期 token)   │     │
│                       └──────────────┬───────────────┘     │
└────────────────────────────────────┼─────────────────────┘
                                     │
              ┌──────────────────────┴───────────────────┐
              ↓                          ↓                 ↓
    ┌────────────────────┐   ┌──────────────────┐   ┌─────────────┐
    │ MiniMax (云)        │   │ NestJS            │   │ 第三方服务  │
    │ ├ speech-to-text WS │   │ (京东云 ECS)      │   │ ├ chatanyw │
    │ ├ speech-t2a-WS-bidi│   │                  │   │ │  here     │
    │ ├ MiniMax m3        │   │ ├ Voice Gateway   │   │ │ (emb)     │
    │ └ voice-design      │   │ ├ Agent Router    │   │ └ TEI      │
    └────────────────────┘   │ ├ RAG Service     │   │   (bge)    │
                            │ ├ Knowledge Base  │   └─────────────┘
                            │ │   + CMS         │
                            │ ├ Embedding Svc   │
                            │ ├ Billing         │
                            │ └ Admin Web       │
                            └──────┬────────────┘
                                   ↓
                          ┌────────────────┐
                          │ Qdrant         │
                          │ (自托管, 1024) │
                          │ 同京东云 ECS   │
                          └────────────────┘
```

### 5.2 数据流概览

| 流 | 方向 | 协议 | 延迟目标 |
|----|------|------|----------|
| User audio | Client → MiniMax ASR | WebSocket | streaming |
| ASR partial | MiniMax → Client | WebSocket | < 300ms |
| ASR text | Client → NestJS | WebSocket | < 50ms (同 ws) |
| LLM context | NestJS → MiniMax m3 | HTTPS streaming | < 200ms first token |
| LLM response | NestJS → Client | WebSocket | streaming |
| TTS text | NestJS → MiniMax bidi | WebSocket | streaming |
| TTS audio | MiniMax → NestJS → Client | WebSocket | < 200ms first packet |

### 5.3 关键设计原则

1. **Audio 路径零中转** — ASR 客户端直连 MiniMax, 仅 TTS 走 NestJS 代理 (凭证安全 + cancel 编排)
2. **LLM 在服务端** — MiniMax m3 由 NestJS 代理, 客户端不接触凭证
3. **协议级原生打断** — 依赖 MiniMax `bidi.task_cancel`, 不在 client 自己丢 chunk 假装
4. **LLM streaming 优先** — LLM 必须 streaming, 不可等完整 response
5. **Tenant 强隔离** — 知识库 / 督导报告 / 训练 session 全部带 `tenantId`
6. **可降级** — ASR 失败 → 手动输入; TTS 失败 → 仅文字; LLM 失败 → 走预设脚本

---

## 6. MiniMax API 集成

### 6.1 API 矩阵

| API | 端点 (待确认) | 用途 | 调用方 | 关键参数 |
|-----|----------------|------|--------|----------|
| **speech-to-text** WS | `wss://api.minimax.chat/v1/asr/stream` (估) | 流式语音转文字 | Client → MiniMax | audio chunks, language=zh-CN, sample_rate=16000 |
| **speech-t2a-websocket-bidi** | `wss://api.minimax.chat/v1/t2a/bidi` (估) | 实时全双工 TTS | NestJS → MiniMax | text stream, voice_id, emotion, model=speech-2.8 |
| **MiniMax m3** HTTP | `https://api.minimax.chat/v1/chat/completions` (估) | LLM 推理 | NestJS → MiniMax | messages, stream=true, model=MiniMax-M3 |
| **voice-design** HTTP | `https://api.minimax.chat/v1/voice/design` (估) | 声音设计 (离线) | 后台任务 | text, voice_type, emotion_range |

> ⚠️ 端点 URL 需用户在 Phase 1 跑联调时确认。**本 SPEC 暂用占位**。

### 6.2 凭证管理

```bash
# .env (mofang-nestjs)
MINIMAX_API_KEY=<user-provided>
MINIMAX_BASE_URL=https://api.minimax.chat
MINIMAX_LLM_MODEL=MiniMax-M3
MINIMAX_TTS_MODEL=speech-2.8
MINIMAX_TTS_DEFAULT_VOICE=mandarin_female_001

# Embedding (用户已提供 2 个 chatanywhere key)
# m plan (生产): 用于生产 embedding
EMBEDDING_API_KEY_MPLAN=<user-provided-key-prefix-sk-cp-...>
EMBEDDING_PROVIDER_PROD=chatanywhere_mplan

# 标准 (开发/测试): 用于 dev/test
EMBEDDING_API_KEY=<user-provided-key-prefix-sk-api-...>
EMBEDDING_PROVIDER_DEV=chatanywhere

# 自托管 bge (生产推荐, 后期切)
EMBEDDING_BGE_URL=http://bge-embedding.internal:8080
EMBEDDING_PROVIDER_PROD=bge_large_zh
```

> 用户提供的 2 个 chatanywhere key (前缀 `sk-api-...` 和 `sk-cp-...`) 不在 SPEC 中明文, 通过 env 注入, 见 §14。

### 6.3 ASR 集成 (speech-to-text WS)

**协议**: WebSocket, 二进制 audio + JSON 控制

**连接生命周期**:
```
Client → MiniMax:
  1. open WS, send config: { model, language, sample_rate, format }
  2. send audio chunks (binary, 16kHz 16-bit mono PCM)
  3. send { "type": "final" } when user stops speaking
  4. close WS on session end

MiniMax → Client:
  - { "type": "partial", "text": "...", "ts": 1234 }   (实时部分)
  - { "type": "final",   "text": "...", "ts": 1234 }   (最终结果)
  - { "type": "error",   "code": "...", "msg": "..." }
```

**错误码矩阵** (待 MiniMax 确认):
- `1001` — auth failed
- `1002` — rate limit
- `2001` — audio format error
- `2002` — audio too long
- `3001` — server busy
- `5001` — internal error

**重试策略**:
- 连接失败: 指数退避 1s/2s/4s, 最多 3 次
- partial 超时 (>5s 无响应): 重连
- final 失败: client 端 fallback 到手动输入

### 6.4 TTS bidi 集成 (speech-t2a-websocket-bidi)

**协议**: WebSocket, JSON 文本 + 二进制 audio

**关键事件 (来自 MiniMax docs)**:

| 事件 | 方向 | 说明 |
|------|------|------|
| `task_start` | Client → Server | 启动任务, 设置 voice_id / emotion / model |
| `task_continue` | Client → Server | 继续流式输入文本 |
| `task_cancel` | Client → Server | **取消当前合成 (打断核心)** |
| `task_continue` | Client → Server | cancel 后继续 |
| `task_flush` | Client → Server | 催出残留文本 (不结束 session) |
| `task_finish` | Client → Server | 结束 session |
| `task_started` | Server → Client | ack task_start |
| `task_continued` | Server → Client | 收到文本 ack |
| `task_canceled` | Server → Client | cancel ack |
| `task_finished` | Server → Client | finish ack |
| `sentence_start` | Server → Client | 新句子开始 (含 text 字段) |
| `sentence_end` | Server → Client | 句子结束 (含完整 text 字段) |
| `audio` (binary) | Server → Client | 音频帧 (持续) |

**emotion 控制**:
- `voice_setting.emotion` 在 `task_start` 时设置 (9 种: `happy`/`sad`/`angry`/`fearful`/`disgusted`/`surprised`/`calm`/`fluent`/`whisper`)
- 模型可自动匹配信本情绪, 也可手动指定
- 文本内嵌 inline tag (18 种): `(laughs)` `(sighs)` `(breath)` `(inhale)` `(coughs)` 等
- **per-session emotion**: 一旦 session 启动, emotion 不能改 — 需 cancel + 重连 (有 100ms 开销)

**策略**:
- Persona baseline 用 `task_start.emotion` (例如"焦虑来访者" = `anxious` 接近 `fearful`)
- Per-utterance 情绪变化用 inline tag (`(sighs)` 表达无奈, `(laughs)` 表达自嘲)
- LLM prompt 明确要求输出含 inline tag

**打断实现**:
```
User VAD 检测到人声
  → Client → NestJS: { "type": "user_speaking" }
  → NestJS → MiniMax: { "type": "task_cancel" }
  → MiniMax → NestJS: { "type": "task_canceled" }
  → NestJS → Client: { "type": "tts_cancelled" }
  → Client: 停止播放, 丢弃后续 audio chunk, 切到 ASR 接收
```

### 6.5 LLM 集成 (MiniMax m3)

**协议**: HTTPS streaming, OpenAI-compatible chat completions

**调用** (NestJS 端):
```typescript
// nestjs/src/agent/llm.service.ts
async streamChat(messages: Message[], opts: StreamOpts): AsyncIterable<TokenChunk> {
  const res = await fetch(`${env.MINIMAX_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.MINIMAX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.MINIMAX_LLM_MODEL,  // MiniMax-M3
      messages,
      stream: true,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 2048,
    }),
  });
  // 解析 SSE 流...
}
```

**关键参数**:
- `stream: true` (必须)
- `temperature`: Visitor 0.7 (有创造性), Supervisor 0.3 (稳定)
- `max_tokens`: Visitor 150, Supervisor 4096 (长报告)

**function call** (后期 V1.x):
- V0.x 不使用 function call, 所有 tool 调用在 NestJS 端编排
- V1.x 可让 LLM 直接调 RAG / KB search

---

## 7. 客户端架构 (Flutter)

### 7.1 客户端技术栈

| 层 | 包 | 用途 |
|----|------|------|
| 状态管理 | `flutter_bloc ^8.x` | 训练会话状态机 |
| 音频采集 | `record ^5.x` | PCM 16kHz mono 录音 |
| 音频播放 | `just_audio ^0.9.x` | 流式 TTS 播放 |
| 音频处理 | `flutter_webrtc ^0.14.x` (audio 模块) | AEC/NS/AGC (仅 Android/iOS) |
| VAD | 自实现 (Silero VAD ONNX) | 端点检测 + 打断检测 |
| WebSocket | `web_socket_channel ^2.x` | 控制 + ASR 通道 |
| 富文本 (CMS) | `super_editor ^0.x` | CMS 内容编辑 |
| 加密存储 | `flutter_secure_storage ^9.x` | API token / persona 配置 |

### 7.2 客户端模块结构

```
xin_su_app/lib/features/counselor_training/
├── bloc/
│   ├── training_bloc.dart          # 主训练会话状态机
│   ├── training_event.dart
│   ├── training_state.dart
│   └── barge_in_controller.dart    # 打断事件
├── audio/
│   ├── audio_capture.dart          # 录音 + AEC/NS/AGC
│   ├── audio_playback.dart         # TTS 播放 + 缓冲
│   ├── vad_detector.dart           # Silero VAD ONNX
│   └── audio_processor.dart        # flutter_webrtc audio processing
├── network/
│   ├── control_ws_client.dart      # NestJS 控制通道
│   ├── asr_ws_client.dart          # MiniMax ASR 直连
│   └── tts_proxy_client.dart       # NestJS TTS 接收
├── data/
│   ├── persona_repository.dart     # Persona 数据
│   ├── session_repository.dart     # 训练 session 历史
│   └── billing_repository.dart     # 会员/配额
├── view/
│   ├── training_page.dart          # 训练主界面
│   ├── persona_select_page.dart    # 角色选择
│   ├── report_view_page.dart       # 督导报告查看
│   └── widgets/
│       ├── waveform_visualizer.dart
│       ├── emotion_indicator.dart
│       └── timer_widget.dart
└── service/
    ├── training_orchestrator.dart  # 业务编排 (跨 bloc/audio)
    └── token_manager.dart          # MiniMax ASR 短期 token
```

### 7.3 3 端适配 (Android/iOS/Web)

| 平台 | 音频采集 | 音频处理 | VAD | TTS 播放 |
|------|----------|----------|-----|----------|
| **Android** | `record` (原生 MediaRecorder) | `flutter_webrtc` audio_processing (AEC3/NS/AGC) | Silero VAD ONNX | `just_audio` |
| **iOS** | `record` (原生 AVAudioSession) | `flutter_webrtc` audio_processing (AEC3/NS/AGC) | Silero VAD ONNX | `just_audio` |
| **Web** | `dart:html` MediaDevices | Web Audio API + RNNoise WASM (AEC 弱, 需耳机) | Silero VAD ONNX | `just_audio` (HTML5 Audio) |

**音频格式统一**: PCM 16kHz 16-bit mono (VAD + ASR 输入)
**网络层**: WebSocket binary frame 直接发 PCM 帧 (每帧 20ms = 640 bytes)

### 7.4 Barge-in 客户端实现

```dart
// barge_in_controller.dart
class BargeInController {
  final AudioCapture _audio;
  final VADDetector _vad;
  final ControlWsClient _control;
  bool _ttsPlaying = false;

  void start() {
    _vad.onSpeechStart.listen(() {
      if (_ttsPlaying) {
        _control.send({'type': 'user_speaking', 'ts': DateTime.now().millisecondsSinceEpoch});
        // Client 端不立即停 TTS 播放 — 等 NestJS ack tts_cancelled 后再停
      }
    });
  }
}
```

**关键**: VAD 必须**早触发** (用户开口 50ms 内), 不等 ASR final。Client 端仅发信号, 等 NestJS ack 后再停止播放 (避免时序竞态)。

---

## 8. NestJS 模块设计

### 8.1 模块清单

```
mofang-nestjs/src/
├── voice/                      # 语音网关
│   ├── voice.module.ts
│   ├── voice.gateway.ts         # WebSocket 入口
│   ├── tts/
│   │   ├── tts-bidi-pool.service.ts   # MiniMax bidi 连接池
│   │   ├── tts-bidi-client.ts         # 单连接封装
│   │   └── tts.types.ts
│   ├── asr/
│   │   ├── asr-token.service.ts       # 短期 OAuth token
│   │   └── asr.types.ts
│   └── barge-in/
│       └── barge-in.orchestrator.ts   # 打断编排
├── training/                   # 训练编排
│   ├── training.module.ts
│   ├── training.controller.ts
│   ├── training.service.ts
│   ├── training-session.entity.ts
│   └── session-state-machine.ts
├── agent/                      # Agent 路由
│   ├── agent.module.ts
│   ├── visitor/
│   │   ├── visitor.service.ts
│   │   ├── visitor.prompts.ts
│   │   └── visitor.types.ts
│   ├── supervisor/
│   │   ├── supervisor.service.ts
│   │   ├── supervisor.prompts.ts
│   │   └── supervisor.types.ts
│   └── llm/
│       ├── llm.service.ts              # MiniMax m3 客户端
│       └── llm.types.ts
├── rag/                        # RAG 服务
│   ├── rag.module.ts
│   ├── retrieval.service.ts
│   ├── reranker.service.ts
│   ├── vector-db/
│   │   ├── vector-db.interface.ts
│   │   └── qdrant.adapter.ts
│   ├── search/
│   │   └── bm25.service.ts        # BM25 全文搜索 (内置 lunr 或轻量 ES)
│   └── prompt-builder.service.ts
├── knowledge-base/             # 知识库 + CMS
│   ├── knowledge-base.module.ts
│   ├── knowledge-item.entity.ts
│   ├── knowledge-version.entity.ts
│   ├── workflow-event.entity.ts
│   ├── knowledge.controller.ts
│   ├── knowledge.service.ts
│   ├── workflow.service.ts          # XState 状态机
│   ├── search.service.ts            # 全文搜索
│   └── preview.service.ts           # 实时预览
├── embedding/                  # 嵌入服务
│   ├── embedding.module.ts
│   ├── embedding.interface.ts
│   ├── chatanywhere-embedding.adapter.ts
│   ├── bge-embedding.adapter.ts
│   └── embedding-factory.ts
├── billing/                    # 计费
│   ├── billing.module.ts
│   ├── billing.service.ts
│   ├── quota.guard.ts
│   └── billing-record.entity.ts
├── analytics/                  # 埋点 + 可观测
│   ├── analytics.module.ts
│   ├── metrics.service.ts          # Prometheus
│   └── tracer.service.ts           # OpenTelemetry
└── common/
    ├── tenant-context.middleware.ts
    ├── auth.guard.ts
    └── ...
```

### 8.2 模块依赖图

```
                ┌──────────────────────┐
                │ Voice Gateway         │
                │  (WebSocket 入口)      │
                └──────┬───────────────┘
                       │
        ┌──────────────┼──────────────┐
        ↓              ↓              ↓
   ┌─────────┐   ┌──────────┐   ┌──────────────┐
   │ TTS Pool│   │ ASR Token│   │ Barge-in     │
   │  (bidi) │   │  Service │   │ Orchestrator │
   └────┬────┘   └─────┬────┘   └──────┬───────┘
        │              │              │
        │              │              ↓
        │              │        ┌──────────┐
        │              │        │ Agent    │
        │              │        │ Router   │
        │              │        └────┬─────┘
        ↓              ↓             │
   ┌────────────────────────────┐    │
   │ LLM Service (MiniMax m3)    │←───┘
   └─────────────┬──────────────┘
                 │
                 ↓
           ┌──────────┐
           │ RAG      │
           │ Service  │
           └────┬─────┘
                │
        ┌───────┼───────┐
        ↓       ↓       ↓
    ┌──────┐ ┌──────┐ ┌────────┐
    │Vector│ │Embed │ │Prompt  │
    │ DB   │ │ Svc  │ │Builder │
    └──────┘ └──────┘ └────────┘

(横向依赖: Billing, Analytics, Auth, TenantContext — 横切关注点)
```

### 8.3 横切关注点

- **Auth Guard** (`@UseGuards(JwtAuthGuard)`): 所有 WebSocket 入口验证 JWT
- **Tenant Context Middleware**: HTTP/WS 入口注入 `req.tenantId`, 知识库/督导报告强校验
- **Quota Guard**: 训练 session 入口检查用户配额
- **Pino Logger**: 结构化日志, 含 `tenantId` / `userId` / `sessionId` / `traceId`
- **OpenTelemetry**: 跨服务追踪 (NestJS → MiniMax API)

---

## 9. Voice Gateway 详细设计

### 9.1 TTS Bidi 连接池

**为什么需要连接池**:
- 1 session = 1 bidi WS 连接 (MiniMax 协议约束)
- 1000 DAU × 1 session = 1000 并发连接
- 单账号并发上限待 MiniMax 确认 (假设 100+)
- 需要客户端侧池化, 超限时排队或拒绝

**池设计**:
```typescript
// tts-bidi-pool.service.ts
@Injectable()
export class TtsBidiPoolService {
  private readonly pool = new Map<string, TtsBidiClient>();  // sessionId → client
  private readonly maxConnections: number;
  private readonly currentConnections: number;
  private readonly waitQueue: Array<{
    sessionId: string;
    resolve: (client: TtsBidiClient) => void;
  }> = [];

  async acquire(sessionId: string, persona: Persona): Promise<TtsBidiClient> {
    if (this.currentConnections >= this.maxConnections) {
      // 排队等待
      return new Promise(resolve => this.waitQueue.push({ sessionId, resolve }));
    }
    const client = new TtsBidiClient({
      url: env.MINIMAX_BASE_URL + '/v1/t2a/bidi',
      apiKey: env.MINIMAX_API_KEY,
      voiceId: persona.voiceId,
      emotion: persona.emotion,
      onAudio: (chunk) => this.broadcastToClient(sessionId, chunk),
      onSentenceEvent: (event) => this.broadcastSentenceEvent(sessionId, event),
    });
    await client.connect();
    await client.taskStart();
    this.pool.set(sessionId, client);
    return client;
  }

  async release(sessionId: string): Promise<void> {
    const client = this.pool.get(sessionId);
    if (client) {
      await client.taskFinish();
      await client.close();
      this.pool.delete(sessionId);
      // 唤醒队列
      if (this.waitQueue.length > 0) {
        const next = this.waitQueue.shift()!;
        const c = await this.acquire(next.sessionId, /* persona from queue */);
        next.resolve(c);
      }
    }
  }
}
```

### 9.2 ASR 短期 Token Service

**为什么需要 token service**:
- 客户端直连 MiniMax ASR, 需要 API key
- 不暴露 MiniMax 凭证给客户端
- 短期 OAuth-style token (5min TTL)

```typescript
// asr-token.service.ts
@Injectable()
export class AsrTokenService {
  async issueToken(userId: string, sessionId: string): Promise<{
    token: string;
    url: string;
    expiresAt: number;
  }> {
    // 短期 token, 内嵌 userId/sessionId, NestJS 端可校验
    const token = await this.signJwt({
      sub: userId,
      sid: sessionId,
      scope: 'asr:stream',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,  // 5min
    }, env.ASR_TOKEN_SECRET);
    return {
      token,
      url: env.MINIMAX_BASE_URL.replace('https', 'wss') + '/v1/asr/stream',
      expiresAt: Date.now() + 300_000,
    };
  }
}
```

**客户端使用**:
```
1. Client → NestJS: POST /voice/asr-token (with user JWT)
2. NestJS → Client: { token, url, expiresAt }
3. Client → MiniMax: open WS with token in header
4. MiniMax → NestJS (反向, 验证 token): async verify (or via shared cache)
```

### 9.3 Barge-in Orchestrator

```typescript
// barge-in.orchestrator.ts
@Injectable()
export class BargeInOrchestrator {
  @WebSocketGateway()
  handleUserSpeaking(@MessageBody() data: { ts: number }, @ConnectedSocket() socket: Socket) {
    const sessionId = socket.data.sessionId;
    
    // 1. 取消 TTS
    const ttsClient = this.ttsPool.get(sessionId);
    ttsClient?.taskCancel();
    
    // 2. 通知 Visitor Agent 停止生成
    this.agentRouter.cancelGeneration(sessionId);
    
    // 3. 等待 MiniMax cancel ack (max 200ms)
    ttsClient?.once('task_canceled', () => {
      socket.emit('tts_cancelled', { ts: Date.now() });
    });
  }
}
```

**延迟预算**:
| 步骤 | 目标 |
|------|------|
| VAD → "user_speaking" | 50ms |
| WS 传输 | 50ms |
| NestJS 处理 + task_cancel | 50ms |
| MiniMax ack | 100ms |
| NestJS → Client "tts_cancelled" | 50ms |
| **总打断恢复** | **~300ms** ✓ |

---

## 10. Barge-in 时序图

### 10.1 正常对话流

```
User      Client                NestJS              MiniMax ASR      MiniMax bidi      LLM m3
 │         │                      │                    │                 │                │
 │──说话───▶│                      │                    │                 │                │
 │         │──audio chunks────────▶│                   │                 │                │
 │         │                      │────ASR WS open────▶│                 │                │
 │         │                      │                    │                 │                │
 │         │                      │◀───partial text────│                 │                │
 │         │                      │                    │                 │                │
 │         │ (停止说话 600ms)      │                    │                 │                │
 │         │                      │                    │                 │                │
 │         │──ASR final text─────▶│                    │                 │                │
 │         │                      │────LLM stream request───────────────▶│                │
 │         │                      │                                                    │
 │         │                      │◀───────────────first token (200ms)──────────────│
 │         │                      │────task_continue (text chunk)─────────────────▶│
 │         │                      │                                                    │
 │         │                      │◀────────────stream tokens (200ms total)──────────│
 │         │                      │                                                    │
 │         │                      │────bidi task_continue (LLM output)─────────────▶│
 │         │                      │                    │                 │              │
 │         │                      │                    │◀──audio chunks──│              │
 │         │                      │────audio chunks───────────────────▶│              │
 │         │◀───audio chunks─────│                    │                 │              │
 │         │───播放───────────────│                    │                 │              │
```

### 10.2 打断流 (Barge-in)

```
User      Client                NestJS              MiniMax bidi      LLM m3
 │         │                      │                    │                 │
 │ (正在听 TTS)                  │                    │                 │
 │         │◀───audio chunks─────│                    │                 │
 │         │──播放                │                    │                 │
 │         │                      │                    │                 │
 │──打断说话▶│                    │                    │                 │
 │         │ VAD 检测             │                    │                 │
 │         │──"user_speaking"───▶│                    │                 │
 │         │                      │────LLM cancel─────▶│                 │
 │         │                      │────task_cancel────────────────────▶│
 │         │                      │                    │                 │
 │         │                      │◀───task_canceled────────────────────│
 │         │                      │────LLM stop signal─────────────────────────────────▶│
 │         │◀──"tts_cancelled"────│                    │                 │
 │         │ 停止播放 + 丢弃       │                    │                 │
 │         │ 切到 ASR 接收        │                    │                 │
 │         │                      │                    │                 │
 │         │──新 ASR stream──────▶│                    │                 │
 │         │                      │ (继续, 等 ASR final)│                 │
```

---

## 11. 多 Agent 系统

### 11.1 Visitor Agent (实时)

**状态机**:
```
idle
  ↓ 用户开始训练
listening
  ↓ VAD 检测到说话
listening (receiving audio)
  ↓ VAD 静默 600ms
listening → thinking
  ↓ ASR final 到达
thinking
  ↓ LLM 推流中
speaking
  ↓ LLM 推流结束 / 或 task_cancel (打断)
  ├→ idle (session 结束)
  ├→ listening (用户又开始说话)
  └→ interrupted (被打断, 继续 listening)
```

**Prompt 模板** (V1.0):
```typescript
// visitor.prompts.ts
export const VISITOR_SYSTEM_PROMPT = `
你是心理咨询中的"来访者", 由用户扮演"咨询师"进行训练.
你有以下人格设定:
- 年龄: ${persona.age}
- 主诉: ${persona.complaint}
- 性格: ${persona.personality}
- 情绪基线: ${persona.emotionBaseline}
- 防御等级: ${persona.defenseLevel}  (1=开放, 5=高度防御)
- 难度: ${persona.difficulty}  (L1=入门, L2=进阶, L3=专家)

回复要求:
1. 说话自然口语化, 像真人一样, 不要书面语
2. 单次回复不超过 50 字 (模拟真人短句)
3. 适当时使用情绪 tag: (sighs) (laughs) (breath) (coughs)
4. 严格保持人格一致性, 不主动揭示是 AI
5. 不提供心理建议 — 你是来访者, 不是咨询师
6. 当用户表达严重情绪困扰时, 维持"来访者"角色, 不替用户做决定

[当前对话历史]
${history}

[最近情绪分析]
${emotionContext}
`;
```

**Inline Tag 注入策略**:
- LLM 输出含 tag 时, 直接传给 TTS (TTS 自动解析)
- TTS 端检测到 `(laughs)` 等 tag, 调整语气

### 11.2 Supervisor Agent (离线, 会话后)

**输入**:
- 完整 transcript (含时间戳)
- ASR 时间戳
- 情绪时序
- persona 元数据
- 督导标准 (RAG 检索 top 5)

**输出**:
```typescript
interface SupervisionReport {
  sessionId: string;
  overallScore: number;  // 0-100
  dimensions: {
    empathy: number;          // 共情
    activeListening: number;  // 主动倾听
    questioning: number;      // 提问技术
    boundary: number;         // 边界
    response: number;         // 反应
    professionalism: number;  // 专业度
  };
  annotations: Array<{
    timestamp: number;        // 对应 transcript 位置
    type: 'good' | 'warn' | 'error';
    category: string;         // 错误分类
    message: string;          // 标注文字
    suggestion?: string;      // 改进建议
  }>;
  errorPatterns: string[];    // 错误模式 (用于 RAG 写入)
  growthSuggestions: string[];
  // ... 写回 RAG 知识库
}
```

**Prompt 模板**:
```typescript
export const SUPERVISOR_SYSTEM_PROMPT = `
你是资深心理咨询督导师, 正在评估一位实习咨询师的训练表现.
你的任务是基于以下训练 transcript + 督导标准, 生成结构化督导报告.

[督导标准 (RAG 检索)]
${ragContext}

[训练 transcript]
${transcript}

[要求]
- 评分客观, 不偏袒
- 标注具体到时间戳
- 错误分类要清晰
- 建议可执行, 不空泛

输出严格遵循 JSON schema: SupervisionReport
`;
```

**Pipeline** (BullMQ 异步):
```
Session 结束 → push to queue
Worker 消费 → 加载 transcript + 情绪时序
  → RAG 检索 (top 5 督导标准)
  → LLM 推理 (MiniMax m3, temperature=0.3)
  → 解析 JSON, 校验 schema
  → 写 DB (supervision_reports)
  → 提取 errorPatterns, 写回 RAG L2 知识库 (自动)
  → 通知用户 (push notification)
```

### 11.3 Agent 抽象层

```typescript
// agent.interface.ts
export interface IAgent {
  readonly id: string;
  readonly type: 'visitor' | 'supervisor';
  run(input: AgentInput): AsyncIterable<AgentOutputChunk>;
  cancel(): void;
}

export interface AgentInput {
  messages: Message[];
  persona?: Persona;
  ragContext?: string;
  emotionContext?: EmotionContext;
}

export interface AgentOutputChunk {
  type: 'text' | 'audio' | 'event';
  text?: string;
  audio?: Int16Array;
  event?: 'sentence_start' | 'sentence_end' | 'done' | 'error';
}
```

---

## 12. 知识库 + CMS

### 12.1 数据模型 (TypeORM)

```typescript
// knowledge-item.entity.ts
@Entity('knowledge_items')
export class KnowledgeItem {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column() tenantId: string;  // 多租户
  @Column({ type: 'enum', enum: KnowledgeType })
  type: 'case' | 'standard' | 'knowledge' | 'enterprise' | 'report';

  @Column() title: string;
  @Column({ type: 'json' }) content: KnowledgeContent;  // 富文本 JSON
  @Column({ type: 'json' }) metadata: KnowledgeMetadata;

  @Column({ type: 'enum', enum: KnowledgeStatus, default: 'draft' })
  status: 'draft' | 'review' | 'published' | 'archived';

  @Column({ type: 'int', default: 1 }) version: number;
  @Column() authorId: string;
  @Column({ nullable: true }) reviewerId: string;
  @CreateDateColumn() createdAt: Date;
  @Column({ nullable: true }) publishedAt: Date;
  @Column({ nullable: true, type: 'timestamptz' })
  scheduledPublishAt: Date;
}

// knowledge-version.entity.ts
@Entity('knowledge_versions')
export class KnowledgeVersion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() itemId: string;
  @Column({ type: 'int' }) version: number;
  @Column({ type: 'json' }) snapshot: KnowledgeContent;
  @Column() authorId: string;
  @CreateDateColumn() createdAt: Date;
  @Column({ type: 'json', nullable: true }) diff: any;  // 跟前一版 diff
}

// workflow-event.entity.ts
@Entity('workflow_events')
export class WorkflowEvent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() itemId: string;
  @Column() fromStatus: KnowledgeStatus;
  @Column() toStatus: KnowledgeStatus;
  @Column() userId: string;
  @CreateDateColumn() timestamp: Date;
  @Column({ nullable: true, type: 'text' }) comment: string;
}
```

### 12.2 工作流状态机 (XState)

```typescript
// workflow.machine.ts
import { createMachine } from 'xstate';

export const knowledgeWorkflow = createMachine({
  id: 'knowledge',
  initial: 'draft',
  states: {
    draft: {
      on: {
        SUBMIT: 'review',
      },
    },
    review: {
      on: {
        APPROVE: 'published',
        REJECT: 'draft',
      },
    },
    published: {
      on: {
        ARCHIVE: 'archived',
        NEW_VERSION_DRAFT: 'draft',  // 新版本重新走流程
      },
    },
    archived: {
      on: {
        RESTORE: 'published',
      },
    },
  },
});
```

### 12.3 实时预览

**用户场景**: 运营在 CMS 编辑"焦虑来访者"案例时, 立即用 LLM 跑一遍, 看生成效果。

**实现**:
```typescript
// preview.service.ts
async preview(itemId: string, persona: Persona): Promise<PreviewResult> {
  const item = await this.knowledgeService.findById(itemId);
  // 1. 模拟用户问 3 句
  const mockUserInputs = ['你好, 最近睡不好', '能具体说说吗', '我该怎么办'];
  // 2. 用当前 content + persona 喂给 LLM
  const responses: string[] = [];
  for (const input of mockUserInputs) {
    const response = await this.visitorService.runOnce({
      persona,
      history: [{ role: 'user', content: input }],
      ragContext: item.content.body,
    });
    responses.push(response);
  }
  return { item, persona, mockUserInputs, responses };
}
```

### 12.4 Admin Web (Flutter Web)

**复用 design system**, 不另起 React/Vue 项目。

| 页面 | 功能 |
|------|------|
| 内容列表 | filter by type/status/author/date, 分页, 搜索 |
| 内容编辑 | super_editor + 元数据表单 + 实时预览 |
| 版本历史 | timeline + diff view + 回滚按钮 |
| 工作流面板 | 我的草稿 / 待我审核 / 已发布 |
| 全文搜索 | BM25, 集成 Aliyun OpenSearch |
| 定时发布 | cron + BullMQ delayed job |
| 权限管理 | RBAC 矩阵 (编辑/审核/管理员) |
| 数据分析 | 内容消费统计 (RAG 检索次数) |

### 12.5 异步向量化流程

```
知识发布 (status: published)
  → emit event: knowledge.published
  → BullMQ job: async-vectorize
    → 加载 content, 切 chunk
    → 调 Embedding service (bge)
    → 写 Vector DB
    → 更新 knowledge_item.vectorizedAt
    → emit: knowledge.indexed
```

---

## 13. 向量数据库 (Qdrant 自托管)

### 13.1 选型决策

| 备选 | 月成本 | 合规 | 推荐度 | 备注 |
|------|--------|------|--------|------|
| **Qdrant (自托管, JD ECS)** | **0 边际** | 走 ECS 整体备案 | ⭐⭐⭐⭐⭐ | **主选** |
| 腾讯云 VectorDB | ~50 元 | ✅ 等保三级 + ICP | ⭐⭐⭐ | 用户弃, 太贵 |
| Aliyun VectorDB | ~30 元 | ✅ 等保三级 | ⭐⭐⭐ | 用户弃, 不用阿里云 |
| 自托管 Milvus (JD ECS) | ~500 元 (重) | 自建 | ⭐⭐ | 工作量大, 不如 Qdrant |

**选 Qdrant**:
- **0 边际成本**: 跟 NestJS 跑同一台京东云 ECS, 独立 Docker 容器, 只占 RAM/CPU, 不增加 ECS 月费
- **高性能**: Rust 写的, 单节点 4C8G 可支撑 10K+ QPS, 满足 1000 DAU 需求
- **开源 + 社区活跃**: Apache 2.0, GitHub 25k+ stars, 持续维护
- **API 友好**: REST + gRPC, TypeScript 官方客户端 `@qdrant/js-client-rest`
- **混合检索原生支持**: 后期 V1.x 想做 hybrid (vector + BM25) 不用换库
- **Payload 灵活**: 每个点带 JSON payload, 多字段 filter 性能 OK
- **量化支持**: Scalar / Product / Binary 量化, 内存可降 4-8 倍

**回退路径**: Qdrant 故障 → 临时切 OpenSearch vector search (V1.x 备选), 或临时降级到关键词搜索 (无 RAG 能力, 但系统不挂)

### 13.2 部署架构 (同 ECS Docker Compose)

```yaml
# docker-compose.yml (新增片段, 同 NestJS 同一 ECS)
services:
  qdrant:
    image: qdrant/qdrant:v1.12.0
    container_name: xinsu_qdrant
    restart: unless-stopped
    ports:
      - "6333:6333"   # REST API
      - "6334:6334"   # gRPC API
    volumes:
      - /data/qdrant:/qdrant/storage  # 京东云 ECS 数据盘
    environment:
      QDRANT__SERVICE__GRPC_PORT: 6334
      QDRANT__STORAGE__PERFORMANCE__MMAP_THRESHOLD: 100
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 4G
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:6333/healthz"]
      interval: 10s
      timeout: 3s
      retries: 3
```

**资源需求** (Qdrant single node, V0.x 足够):
- CPU: 2 vCPU (跟 NestJS 共享 4C8G ECS)
- RAM: 4 GB (HNSW index + payload cache)
- 存储: ~1 GB / 10K 1024-dim vectors (含 payload)
- 网络: 内网 (跟 NestJS 同 VPC)

**京东云 ECS 配置建议** (Phase 6 部署):
- 4 vCPU / 8 GB RAM / 100 GB SSD (跟 NestJS 共用)
- 单实例 ~300 元/月 (4C8G, 100G SSD)
- 跟 Qdrant 一起跑, **总成本 = 1 台 ECS, 不是 2 台**

### 13.3 Collection Schema (Qdrant 风格)

```typescript
// qdrant.adapter.ts
import { QdrantClient } from '@qdrant/js-client-rest';

const COLLECTION_NAME = 'knowledge_chunks';

@Injectable()
export class QdrantAdapter implements IVectorDb {
  private client: QdrantClient;
  
  constructor() {
    this.client = new QdrantClient({
      url: env.QDRANT_URL,         // http://qdrant:6333 (同 ECS 内网)
      apiKey: env.QDRANT_API_KEY,   // 可选, 生产建议开
    });
  }
  
  async ensureCollection(): Promise<void> {
    const exists = await this.client.collectionExists(COLLECTION_NAME);
    if (!exists.exists) {
      await this.client.createCollection(COLLECTION_NAME, {
        vectors: {
          size: 1024,           // 跟 embedding dim 一致
          distance: 'Cosine',   // 余弦相似度
        },
        // HNSW 索引
        hnsw_config: {
          m: 16,                    // 每节点 16 邻居
          ef_construct: 200,        // 构建时搜索深度
        },
        // 量化: int8 scalar, 内存降 4 倍, 精度损失 < 1%
        quantization_config: {
          scalar: {
            type: 'int8',
            quantile: 0.99,
            always_ram: true,
          },
        },
        // 优化: payload 索引
        // (Qdrant 自动为 keyword 类型建索引)
      });
      
      // payload 字段索引 (Qdrant 支持按需建)
      await this.client.createPayloadIndex(COLLECTION_NAME, {
        field_name: 'tenantId',
        field_schema: 'keyword',
      });
      await this.client.createPayloadIndex(COLLECTION_NAME, {
        field_name: 'type',
        field_schema: 'keyword',
      });
      await this.client.createPayloadIndex(COLLECTION_NAME, {
        field_name: 'status',
        field_schema: 'keyword',
      });
      await this.client.createPayloadIndex(COLLECTION_NAME, {
        field_name: 'itemId',
        field_schema: 'keyword',
      });
    }
  }
  
  async upsert(points: VectorPoint[]): Promise<void> {
    await this.client.upsert(COLLECTION_NAME, {
      points: points.map(p => ({
        id: p.id,
        vector: p.vector,
        payload: {
          tenantId: p.tenantId,
          content: p.content,
          type: p.type,
          status: p.status,
          difficulty: p.difficulty,
          tags: p.tags,
          itemId: p.itemId,
          version: p.version,
          createdAt: p.createdAt,
        },
      })),
    });
  }
  
  async search(vector: number[], opts: SearchOpts): Promise<SearchResult[]> {
    const res = await this.client.search(COLLECTION_NAME, {
      vector,
      limit: opts.topK,
      filter: {
        must: [
          { key: 'tenantId', match: { value: opts.tenantId } },
          { key: 'status', match: { value: 'published' } },
          ...(opts.types ? [{ key: 'type', match: { any: opts.types } }] : []),
        ],
      },
      with_payload: true,
      with_vector: false,
      score_threshold: opts.scoreThreshold ?? 0.5,  // 过滤低分
    });
    return res.map(r => ({
      id: r.id as string,
      score: r.score,
      payload: r.payload as any,
    }));
  }
  
  async deleteByItemId(itemId: string): Promise<void> {
    await this.client.delete(COLLECTION_NAME, {
      filter: { must: [{ key: 'itemId', match: { value: itemId } }] },
    });
  }
}
```

### 13.4 检索策略 (向量 + BM25 混合)

```typescript
// retrieval.service.ts
async retrieve(query: string, opts: RetrieveOpts): Promise<RetrievalResult> {
  const queryVec = await this.embedding.embed(query);
  
  // 1. 向量召回 (Qdrant top 20)
  const vectorResults = await this.qdrant.search(queryVec, {
    tenantId: opts.tenantId,
    types: opts.types,
    topK: 20,
  });
  
  // 2. BM25 召回 (top 20) — 内置轻量搜索引擎
  //    V0.x 用 lunr.js (Node) 在 MySQL 上做全文索引
  //    V1.x 可换 OpenSearch / Meilisearch
  const bm25Results = await this.bm25.search({
    query,
    tenantId: opts.tenantId,
    types: opts.types,
    topK: 20,
  });
  
  // 3. 合并 + 重排 (cross-encoder 或 LLM re-rank, top 5)
  const merged = this.mergeAndDedupe([...vectorResults, ...bm25Results]);
  const reranked = await this.reranker.rerank(query, merged, { topK: 5 });
  
  return {
    chunks: reranked,
    metadata: {
      vectorHits: vectorResults.length,
      bm25Hits: bm25Results.length,
    },
  };
}
```

**hybrid 策略说明**:
- 向量召回: 语义相似 (如"焦虑" 召回 "紧张/担心/不安")
- BM25 召回: 关键词精准 (如"54321 ground technique" 召回 标题含此词的 KB)
- 合并去重: 按 itemId + chunk 位置去重
- 重排: V0.x 用 LLM 评分 (`MiniMax m3` 给 0-10 分), V1.x 可上 `bge-reranker-large`

### 13.5 监控 + 维护

```typescript
// 定期输出 Qdrant 健康指标
async getHealth(): Promise<QdrantHealth> {
  const info = await this.qdrant.client.getCollection(COLLECTION_NAME);
  return {
    pointsCount: info.points_count,
    vectorsCount: info.vectors_count,
    indexedVectorsCount: info.indexed_vectors_count,
    segmentsCount: info.segments_count,
    diskUsage: info.disk_data_size,
    ramUsage: info.ram_data_size,
  };
}
```

**Prometheus 指标** (`qdrant_*` prefix):
- `qdrant_collection_points_total`
- `qdrant_search_duration_seconds`
- `qdrant_upsert_duration_seconds`
- `qdrant_disk_bytes`
- `qdrant_ram_bytes`

**备份策略**:
- Qdrant snapshot API → 京东云 OSS (每日 1 次, 7 天保留)
- 灾难恢复: ECS 重启 + snapshot 拉取 ~10 分钟 RTO


---

## 14. Embedding 服务

### 14.1 选型

| 选项 | 维度 | 成本 | 推荐 |
|------|------|------|------|
| **bge-large-zh-v1.5 (自托管 TEI)** | 1024 | ~500元/月 (4C8G ECS) | **生产主选** (中文 SOTA) |
| chatanywhere `text-embedding-3-small` | 1024 | $0.00014/1K tok | 开发/测试, 应急 |
| chatanywhere `text-embedding-3-large` | 3072 | $0.00091/1K tok | 不选 (维度不一致) |

**用户已提供 2 个 chatanywhere key** (前缀 `sk-api-...` 和 `sk-cp-...`):
- `sk-api-...`: 标准 tier, 限速较严
- `sk-cp-...`: m plan, 中等限速, 适合生产

**生产策略**:
- **主**: bge-large-zh-v1.5 (自托管 TEI) — 中文 SOTA, 维度 1024
- **备**: chatanywhere `text-embedding-3-small` (m plan) — bge 故障时切换, 维度一致无需重做 schema

### 14.2 TEI 部署

**Docker 部署** (推荐):
```yaml
# docker-compose.yml (片段)
services:
  bge-embedding:
    image: ghcr.io/huggingface/text-embeddings-inference:1.5
    runtime: nvidia  # 或 cpu
    environment:
      - MODEL_ID=BAAI/bge-large-zh-v1.5
    ports:
      - "8080:80"
    deploy:
      resources:
        limits:
          memory: 4G
```

**资源需求**:
- CPU 模式: 4 vCPU + 8GB RAM, 单实例 50 QPS
- GPU 模式: 1× T4 + 8GB RAM, 单实例 200 QPS
- V0.x 阶段用 CPU 模式 (成本低, QPS 足够)

### 14.3 抽象层

```typescript
// embedding.interface.ts
export interface IEmbedding {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dim: 1024;
}

// chatanywhere-embedding.adapter.ts
@Injectable()
export class ChatanywhereEmbedding implements IEmbedding {
  readonly dim = 1024;
  constructor(private readonly config: ConfigService) {}
  
  async embed(text: string): Promise<number[]> {
    const res = await fetch('https://api.chatanywhere.tech/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.get('EMBEDDING_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    });
    const data = await res.json();
    return data.data[0].embedding;
  }
}

// bge-embedding.adapter.ts
@Injectable()
export class BgeEmbedding implements IEmbedding {
  readonly dim = 1024;
  constructor(private readonly http: HttpService) {}
  
  async embed(text: string): Promise<number[]> {
    const res = await this.http.post(`${env.EMBEDDING_BGE_URL}/embed`, {
      inputs: [text],
    }).toPromise();
    return res.data[0];
  }
}

// embedding-factory.ts
export const EmbeddingProvider = {
  provide: 'IEmbedding',
  useFactory: (config: ConfigService) => {
    const provider = config.get('EMBEDDING_PROVIDER_PROD');
    if (provider === 'bge_large_zh') return new BgeEmbedding(/* ... */);
    if (provider === 'chatanywhere_mplan') return new ChatanywhereEmbedding(/* m plan key */);
    if (provider === 'chatanywhere') return new ChatanywhereEmbedding(/* standard key */);
    throw new Error(`Unknown embedding provider: ${provider}`);
  },
  inject: [ConfigService],
};
```

### 14.4 切换路径 (零成本)

由于 chatanywhere 3-small 和 bge 都是 1024 维, 切换只需:
1. 改 `EMBEDDING_PROVIDER_PROD` env
2. 重启 NestJS
3. **不需要**重建 Vector DB index (新 embedding 维度一致, 旧数据可保留或异步重写)

---

## 15. 数据模型 (TypeORM Entities)

### 15.1 核心实体

```typescript
// training-session.entity.ts
@Entity('training_sessions')
export class TrainingSession {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() tenantId: string;
  @Column() userId: string;
  @Column() personaId: string;
  @Column({ type: 'enum', enum: SessionStatus })
  status: 'active' | 'completed' | 'aborted' | 'error';
  @CreateDateColumn() startedAt: Date;
  @Column({ nullable: true, type: 'timestamptz' }) endedAt: Date;
  @Column({ type: 'json' }) transcript: TranscriptEntry[];
  @Column({ type: 'json' }) emotionTimeline: EmotionSnapshot[];
  @Column({ type: 'int', default: 0 }) totalTurns: number;
  @Column({ type: 'int', default: 0 }) userUtterances: number;
  @Column({ type: 'int', default: 0 }) visitorUtterances: number;
  @Column({ type: 'int', default: 0 }) bargeInCount: number;
  @Column({ type: 'json', nullable: true }) supervisionReport: any;
  @Column({ type: 'decimal', precision: 10, scale: 4, default: 0 })
  costAsr: number;
  @Column({ type: 'decimal', precision: 10, scale: 4, default: 0 })
  costTts: number;
  @Column({ type: 'decimal', precision: 10, scale: 4, default: 0 })
  costLlm: number;
}

// persona.entity.ts
@Entity('personas')
export class Persona {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() tenantId: string;
  @Column() name: string;
  @Column() age: number;
  @Column({ type: 'enum', enum: PersonaDifficulty })
  difficulty: 'L1' | 'L2' | 'L3';
  @Column({ type: 'text' }) complaint;       // 主诉
  @Column({ type: 'text' }) personality;    // 性格
  @Column({ type: 'text' }) background;     // 背景
  @Column({ default: 'calm' }) emotionBaseline: string;
  @Column({ type: 'int', default: 1 }) defenseLevel: number;
  @Column({ nullable: true }) voiceId: string;  // MiniMax voice-design 生成的 id
  @Column({ type: 'json', nullable: true }) knowledgeRefs: string[];  // 关联的 KB item ids
  @Column({ default: true }) isActive: boolean;
}

// supervision-report.entity.ts
@Entity('supervision_reports')
export class SupervisionReport {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() sessionId: string;
  @Column() tenantId: string;
  @Column() userId: string;
  @Column({ type: 'int' }) overallScore: number;
  @Column({ type: 'json' }) dimensions: Record<string, number>;
  @Column({ type: 'json' }) annotations: any[];
  @Column({ type: 'json' }) errorPatterns: string[];
  @Column({ type: 'text', array: true }) growthSuggestions: string[];
  @Column({ default: false }) indexedToRag: boolean;  // 是否已写回 KB
  @CreateDateColumn() createdAt: Date;
}
```

### 15.2 Migration 计划

- `migrations/1739000000000-create-training-sessions.ts`
- `migrations/1739000001000-create-personas.ts`
- `migrations/1739000002000-create-supervision-reports.ts`
- `migrations/1739000003000-create-knowledge-base.ts`
- `migrations/1739000004000-create-billing.ts`

由用户 (`pnpm migration:run`) 跑, 本 SPEC 不自动执行。

---

## 16. 鉴权 / 多租户

### 16.1 Auth

复用现有 `auth/` 模块:
- JWT (HS256, 7 天 access + 30 天 refresh)
- 现有 `JwtAuthGuard` 直接 `@UseGuards` 即可
- WebSocket 入口用 `socket.handshake.auth.token` 提取

### 16.2 多租户 (原生支持, 扩展现有 User 模型)

**现状** (扫了现有 mofang-nestjs/src):
- `User` entity 有 `uid` / `phone` / `email` / `passwordHash` / `state` / `lastLoginAt` / `failedLoginCount` / `lockedUntil` 等, **无 `tenantId` 字段**
- `auth.interface.ts` 的 `JwtPayload` = `{ sub, username, roles, type }`, **无 `tenantId`**
- `auth.serializer.ts` Passport 序列化, 不感知 tenant

**V0.x 改造 (Phase 1 同步执行)**:

1. **User entity 加 `tenantId` 字段** (VARCHAR(64), NOT NULL, 索引)

```typescript
// src/user/entities/user.entity.ts (新增字段)
@Entity('users')
export class User {
  // ... 现有字段 ...

  /**
   * V2026-10-08 治本 (多租户原生支持):
   *   V0.x 默认 `tenantId = uid` (每人自营 = 隐式单租户), V1.x 接 Tenant
   *   实体后改为组织 id. 现有用户 backfill: `UPDATE users SET tenant_id = uid
   *   WHERE tenant_id = ''`, 单条 migration 完成.
   */
  @Index()
  @Column({ type: 'varchar', length: 64, name: 'tenant_id' })
  tenantId!: string;
}
```

2. **JwtPayload 加 `tenantId`**

```typescript
// src/auth/auth.interface.ts
export interface JwtPayload {
  sub: string;
  username: string;
  roles: string[];
  tenantId: string;  // V2026-10-08 新增
  type?: 'access' | 'refresh';
}

export interface Payload {
  userId: string;
  username: string;
  roles: string[];
  tenantId: string;  // V2026-10-08 新增
}
```

3. **AuthService.jwtSign 注入 tenantId**

```typescript
// src/auth/auth.service.ts
public jwtSign(data: Payload): JwtSign {
  const payload: JwtPayload = {
    sub: data.userId,
    username: data.username,
    roles: data.roles,
    tenantId: data.tenantId,  // V2026-10-08 新增
  };
  // ... 签发逻辑不变
}
```

4. **TenantContext Decorator (替代原 TenantContextMiddleware 设想)**

```typescript
// src/common/decorators/tenant-context.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest();
    return req.user?.tenantId;
  },
);

// WebSocket 端: socket.data.tenantId (在 connection 时由 JwtAuthGuard 注入)
```

5. **TenantContextGuard (WebSocket)**

```typescript
// src/common/guards/tenant-context.guard.ts
@Injectable()
export class TenantContextGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!req.user?.tenantId) {
      throw new ForbiddenException('Missing tenant context');
    }
    return true;
  }
}
```

6. **业务 service 强校验 tenantId**

```typescript
// src/knowledge-base/knowledge.service.ts (节选)
async findById(id: string, tenantId: string): Promise<KnowledgeItem> {
  const item = await this.repo.findOne({ where: { id, tenantId } });
  if (!item) throw new NotFoundException();
  return item;
}

// src/training/training.service.ts
async createSession(userId: string, tenantId: string, dto: CreateSessionDto) {
  // tenantId 从 JWT 取, 不接受 client 传入, 防止越权
  const session = this.repo.create({
    userId,
    tenantId,
    personaId: dto.personaId,
    status: 'active',
    startedAt: new Date(),
    transcript: [],
    emotionTimeline: [],
  });
  return this.repo.save(session);
}
```

**V0.x 租户策略**:

| 场景 | tenantId 取值 | 说明 |
|------|----------------|------|
| 普通 C 端用户 | `uid` (自营) | 每个用户一个 tenant, 数据天然隔离 |
| B 端企业接入 (V1.x) | 组织 `org_xxx` | 同组织多用户共享 KB / persona |
| 系统管理员 (V1.x) | `system` | 看全量数据, RBAC 严格控制 |

**回退路径**: V0.x 默认 `tenantId = uid`, 不引入 Tenant 实体, 改动面最小, V1.x 加 Tenant 时只需:
1. 新建 `tenants` 表
2. `users.tenant_id` 改为 FK
3. 加邀请 / 角色 / 租户切换 UI

**为什么不直接建 Tenant 实体**:
- V0.x 阶段还没有 B 端需求, 提前建 = 过度设计
- 但**架构必须原生支持** (data 隔离, JWT 带 tenantId, 业务强校验), 否则 V1.x 接 B 端要重写全部 query
- "架构原生 + 实体延后" 是治本思路: 字段预留, 实体现身时机由业务决定

### 16.3 RBAC (CMS)

| 角色 | 权限 |
|------|------|
| `viewer` | 只能查看已发布内容 |
| `editor` | 创建/编辑 draft, 提交 review |
| `reviewer` | 审核 draft, 通过/拒绝 |
| `admin` | 所有权限 + 删除 + 强制发布 + 用户管理 |

用 `@casl/ability` 库实现。

---

## 17. 商业化模型

### 17.1 定价表

| 套餐 | 价格 | 训练 session | 单次 TTS 字符 | 有效期 |
|------|------|--------------|----------------|--------|
| **免费** | ¥0 | 3 次/天 | 1000 | 永久 |
| **会员** (包月) | ¥99/月 | 30 次/月 | 10000 | 30 天 |
| **次数包-小** | ¥49 | 5 次 | 5000 | 90 天 |
| **次数包-中** | ¥89 | 10 次 | 5000 | 90 天 |
| **次数包-大** | ¥159 | 20 次 | 5000 | 180 天 |
| **单次体验** | ¥9 | 1 次 | 2000 | 7 天 |

### 17.2 计费 service

```typescript
// billing.service.ts
@Injectable()
export class BillingService {
  async checkQuota(userId: string): Promise<QuotaStatus> {
    const sub = await this.getActiveSubscription(userId);
    if (!sub) return { canStart: false, reason: 'no_active_subscription' };
    if (sub.usedSessions >= sub.totalSessions) {
      return { canStart: false, reason: 'quota_exhausted' };
    }
    return { canStart: true, remaining: sub.totalSessions - sub.usedSessions };
  }

  async consumeSession(userId: string, sessionId: string): Promise<void> {
    // 原子扣减, 防并发
    await this.db.transaction(async (tx) => {
      const sub = await tx.lock('subscription', 'user_id', userId);
      if (sub.usedSessions >= sub.totalSessions) {
        throw new QuotaExhaustedException();
      }
      sub.usedSessions += 1;
      await tx.save(sub);
      await tx.insert('billing_record', {
        userId, sessionId,
        type: 'session_consume',
        amount: 1,
        createdAt: new Date(),
      });
    });
  }
}
```

### 17.3 支付集成

- 微信支付 (V0.x 主)
- 支付宝 (V0.x)
- Apple Pay / Google Play (V0.x for iOS/Android)
- 企业月结 (V1.x, 走销售流程)

---

## 18. 可观测性

### 18.1 Logging (Pino)

```typescript
// common/logger.config.ts
import { pino } from 'pino';

export const logger = pino({
  level: env.LOG_LEVEL ?? 'info',
  base: {
    service: 'mofang-nestjs',
    tenantId: undefined,  // 运行时注入
  },
  redact: ['req.headers.authorization', 'req.body.password'],
  transport: env.NODE_ENV === 'production' ? undefined : {
    target: 'pino-pretty',
  },
});
```

**结构化字段**:
- `tenantId`, `userId`, `sessionId`
- `event` (action type)
- `durationMs` (耗时)
- `cost` (花费, 用于成本监控)
- `error.code`, `error.message`

### 18.2 Metrics (Prometheus)

| 指标 | 类型 | 用途 |
|------|------|------|
| `voice_session_active` | gauge | 当前活跃 session 数 |
| `voice_session_total` | counter | 累计 session 数 |
| `voice_session_duration_seconds` | histogram | session 持续时长 |
| `voice_first_byte_latency_ms` | histogram | 首响延迟 (目标 < 1000ms) |
| `voice_barge_in_count` | counter | 打断次数 |
| `llm_token_usage_total` | counter | LLM token 消耗 |
| `minimax_api_errors_total` | counter | MiniMax API 错误 (按错误码分桶) |
| `cost_total` | counter | 累计成本 |

### 18.3 链路追踪 (OpenTelemetry)

```typescript
// common/tracer.config.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: env.OTEL_EXPORTER_OTLP_ENDPOINT }),
  instrumentations: [getNodeAutoInstrumentations()],
  serviceName: 'mofang-nestjs-voice',
});
sdk.start();
```

**追踪**:
- HTTP 入 → 业务处理 → MiniMax API → 出
- WebSocket 消息全链路
- 跨 NestJS → MiniMax API (HTTP)

---

## 19. 安全 / 合规

### 19.1 用户录音授权

- 训练开始前, 必须弹窗确认"本训练将进行语音录制与 AI 分析, 仅您本人可见, 30 天后自动删除"
- 用户必须勾选同意 + 点击"开始训练"
- 授权记录存 `consent_records` 表, 含 IP / 时间戳 / 用户 agent

### 19.2 数据生命周期

| 数据 | 存储位置 | 保留期 | 删除策略 |
|------|----------|--------|----------|
| 训练 session 元数据 | MySQL | 永久 (用于历史) | 用户主动删除 |
| 训练 audio (原始录音) | 客户端本地 (Isar) | 30 天 | 客户端定时清理 |
| ASR 文本 | MySQL (transcript) | 永久 | 用户主动删除 |
| 督导报告 | MySQL | 永久 | 用户主动删除 |
| 训练 session 期间 MiniMax 临时处理 | MiniMax 云端 | 不持久化 (MiniMax 协议保证) | session 结束立即丢弃 |

### 19.3 API 凭证

- **MiniMax API key**: 仅 NestJS 服务端, 不下发到 client
- **Embedding API key**: 仅 NestJS 服务端
- **短期 token (5min)**: client 用来直连 ASR, 过期自动失效
- **存储**: 全部走 env + secrets manager (生产: 阿里云/AWS Secrets Manager; 京东云需找替代)

### 19.4 等保备案

- **目标**: 等保三级
- **时点**: Phase 9 (生产化) 期间申请
- **责任方**: 用户 (公司侧) 主导, 我方提供技术文档支持

---

## 20. 性能预算

### 20.1 实时对话延迟预算

| 环节 | 目标 | 测量 |
|------|------|------|
| VAD 端点检测 | < 50ms | client 端埋点 |
| ASR partial | < 300ms | ASR 厂商指标 |
| LLM first token | < 200ms | MiniMax m3 实测 |
| TTS first packet | < 200ms | MiniMax bidi 实测 |
| **首响 (user stop → first audio)** | **< 1000ms** | 端到端埋点 |
| 打断恢复 | < 400ms | 端到端埋点 |

### 20.2 吞吐量

- **并发 session 上限**: 1000 (待 MiniMax 确认单账号上限)
- **NestJS 节点**: 2× 4C8G, 每节点 ~500 session
- **Vector DB QPS**: 假设 1000 DAU × 10 RAG/session = 10K QPS 峰值

### 20.3 客户端性能

- 音频处理延迟: < 50ms (Android/iOS via flutter_webrtc)
- VAD 推理: < 10ms (Silero ONNX, 2MB 模型)
- WebSocket 重连: < 2s

---

## 21. 12 周排期

| 阶段 | 周 | 核心交付 | 关键路径 | 风险 |
|------|---|---------|----------|------|
| 1. MiniMax 联调 | 1 | Android `bidi` + ASR + m3 3 个 demo | 3 API 联调 | 实际延迟 / 协议坑 |
| 2. 音频处理 (3 端) | 1-2 | flutter_webrtc audio + Silero VAD + just_audio | 跨平台 audio | Web AEC 难 |
| 3. Voice Gateway | 2-3 | NestJS TTS 代理 + ASR token + 打断编排 | bidi cancel 时序 | 时序竞态 |
| 4. Visitor Agent | 3-4 | Agent 状态机 + persona 库 + emotion inline tag | LLM prompt 调优 | 情绪一致性 |
| 5. Supervisor | 4 | 离线督导报告 + rubric + 自动回写 RAG | 评分标准化 | rubric 主观性 |
| 6. RAG + Embedding | 5 | Qdrant 自托管 + bge TEI 部署 + 检索 service | 部署 + 调优 | 检索质量 |
| 7. KB + CMS 全功能 | 6-8 | CRUD + 工作流 + 版本 + 全文搜索 + 定时 + 预览 + Admin Web | CMS 复杂度 | UI 工作量 |
| 8. 商业化 | 8-9 | 会员/次数包/单次/支付/计费 | 计费准确性 | 支付集成 |
| 9. 调优 + 生产化 | 10-12 | 可观测/限流/熔断/等保备案 | 部署上线 | 等保耗时 |

**总交付**: MVP (Phase 1-5) + CMS (Phase 7) + 商业化 (Phase 8) + 生产化 (Phase 9)

---

## 22. 风险登记 (Risk Register)

| ID | 风险 | 影响 | 概率 | 缓解措施 | 负责阶段 |
|----|------|------|------|----------|----------|
| **R1** | MiniMax m3 LLM streaming 实际首 token 延迟 > 200ms | 整体首响 > 1s | 中 | 提前压测, 准备 prompt 压缩, 流式降级到非流式 | Phase 1 |
| **R2** | MiniMax bidi `task_cancel` 在生产不稳定 | 打断体验崩 | 低 | 协议层 + client drop 双重保险, 监控 cancel 成功率 | Phase 3 |
| **R3** | Qdrant 故障 / ECS 内存溢出 / 磁盘满 | RAG 服务挂 | 低 | 1. 监控告警 (`qdrant_ram_bytes > 6GB` 报警) 2. 自动重启 (Docker restart=always) 3. 备份: 每日 Qdrant snapshot → 京东云 OSS, RTO 10 分钟 | Phase 6 |
| **R4** | bge-large-zh-v1.5 自托管资源不足 / QPS 不够 | 检索慢 | 中 | CPU 模式 4C8G 可支撑 50 QPS, 够 1000 DAU; 不足时扩 GPU | Phase 6 |
| **R5** | LLM prompt 调优不达预期 (AI 来访者不像真人) | 训练效果差 | 中 | 准备 5+ persona + 5+ 场景对话 demo, 用户 review 调优 | Phase 4 |
| **R6** | 督导报告 rubric 标准化难, 用户主观评分低 | 产品口碑差 | 高 | 邀请 3-5 位资深督导师联合制定 rubric, 灰度测试 | Phase 5 |
| **R7** | CMS UI 工作量大, Flutter Web 经验不足 | 进度拖延 | 中 | 优先做核心 CRUD, 高级功能 (diff/预览) 后期补 | Phase 7 |
| **R8** | MiniMax 单账号并发连接上限 < 1000 | 容量瓶颈 | 中 | 多账号池化 (申请 3-5 个企业账号), 负载均衡 | Phase 3 |
| **R9** | Web 端 AEC 体验差 (浏览器无原生 AEC) | Web 用户体验降级 | 中 | 文档强制要求使用耳机, 后续可接 RNNoise | Phase 2 |
| **R10** | 等保三级备案耗时 > 3 个月 | 上线延迟 | 中 | 提前启动, V0.5 即提交申请 | Phase 9 |
| **R11** | 微信支付/支付宝集成踩坑 | 商业化延迟 | 中 | 用成熟 SDK (WxPay-SDK), 充分 sandbox 测试 | Phase 8 |
| **R12** | chatanywhere key 限速或服务不稳定 | embedding 失败 | 中 | 主用 bge, chatanywhere 仅 fallback | Phase 6 |

---

## 23. 待确认问题 (Open Questions)

| # | 问题 | 阻塞阶段 | 期望答复 |
|---|------|----------|----------|
| **Q1** | MiniMax 商业账号信息: Free Tier / 测试账号 / 单账号并发上限 / 实际 first byte 延迟 | Phase 1 | 联系人/账号信息 |
| **Q2** | MiniMax `bidi` 协议是否需要 client 提供 voice_id, 还是 MiniMax 自动选默认 | Phase 3 | docs 确认 |
| **Q3** | 督导报告是否需要双盲 (督导师不可见用户身份) | Phase 5 | 产品决策 |
| **Q4** | L1/L2/L3 难度的具体区别 (L1 = 入门无防御, L2 = 中等防御, L3 = 高度阻抗) 是否符合预期 | Phase 4 | 产品 review |
| **Q5** | AI 来访者语种是否需要支持方言 (粤语/上海话等) | Phase 4 | 暂不, 后期议 |
| **Q6** | 督导报告是否要给学员看"错误次数排行榜"等社交化功能 | Phase 5 | 暂不, 避免挫败感 |
| **Q7** | 是否需要"训练历史回放"功能 (语音 + 转写 + 标注) | Phase 5 | 暂存本地, 不在 V0.x 服务端 |
| **Q8** | 商业化: 是否需要"赠送 session"营销工具 (运营后台手动加) | Phase 8 | 建议做, 1 天工作量 |
| **Q9** | 是否需要"训练报告分享给督导师"功能 (不是 Supervisor 自动报告) | Phase 5 | 暂不做, 后期议 |
| **Q10** | 等保备案的主体: 公司还是产品名? 影响等保申请材料 | Phase 9 | 法务/行政确认 |
| **Q11** | 现有 User entity 加 `tenantId` 字段, V0.x 默认 `tenantId = uid` 接受吗? (隐式单租户, 每用户自营) | Phase 1 阻塞 | 产品决策 |
| **Q12** | V0.x 阶段会有 B 端组织 (学校/医院/公司) 接入吗? 如果有, 同步建 Tenant 实体; 如果没有, V1.x 再建 | Phase 1 阻塞 | 产品决策 |

---

## 24. 附录

### 24.1 Glossary

| 术语 | 含义 |
|------|------|
| **Barge-in** | 用户在 AI 说话时插入, 打断 AI |
| **VAD** | Voice Activity Detection, 端点检测 |
| **AEC** | Acoustic Echo Cancellation, 回声消除 |
| **NS** | Noise Suppression, 噪声抑制 |
| **AGC** | Automatic Gain Control, 自动增益 |
| **Persona** | AI 来访者的人格设定 (性格/主诉/背景) |
| **Inline Tag** | TTS 文本中嵌入的情绪标记, 如 `(laughs)` |
| **RAG** | Retrieval-Augmented Generation, 检索增强生成 |
| **Rubric** | 评分量规, 督导报告的评分标准 |
| **TEI** | Text Embeddings Inference, HuggingFace 的 embedding 服务框架 |
| **等保** | 信息安全等级保护 (中国合规) |
| **ICP** | Internet Content Provider (中国网站备案) |

### 24.2 引用

- MiniMax API 文档 (用户提供):
  - `https://platform.minimax.cn/docs/api-reference/speech-to-text`
  - `https://platform.minimax.cn/docs/api-reference/speech-t2a-websocket`
  - `https://platform.minimax.cn/docs/api-reference/speech-t2a-websocket-bidi`
  - `https://platform.minimax.cn/docs/api-reference/voice-design-design`
- MiniMax m3 LLM 文档 (待补充 URL)
- 腾讯云 VectorDB: `https://cloud.tencent.com/product/vdb` (备选, 已弃)
- Qdrant: `https://qdrant.tech/` / `https://github.com/qdrant/qdrant` / `https://qdrant.tech/documentation/`
- TEI: `https://github.com/huggingface/text-embeddings-inference`
- bge-large-zh-v1.5: `https://huggingface.co/BAAI/bge-large-zh-v1.5`
- Silero VAD: `https://github.com/snakers4/silero-vad`
- flutter_webrtc: `https://pub.dev/packages/flutter_webrtc`

### 24.3 Changelog

| 版本 | 日期 | 变更 |
|------|------|------|
| v0.1 | 2026-10-08 | 初稿, 24 章完整覆盖 |

---

## SPEC Review Checklist (用户确认项)

- [ ] 假设 (A1-A8) 是否成立
- [ ] 范围 (§2) 是否需要调整
- [ ] MiniMax 商业信息 (Q1) 是否提供
- [ ] Qdrant 自托管资源 (JD ECS 4C8G 跑 NestJS + Qdrant + bge 够 1000 DAU? 待 Phase 6 实测)
- [ ] chatanywhere key 2 个是否按 SPEC env 注入
- [ ] 12 周排期 (§21) 是否可行
- [ ] 风险登记 (§22) 是否有遗漏
- [ ] 待确认问题 (§23 Q1-Q10) 哪些需要先答

> 用户确认后, 进入 **SPEC v0.2 → PLAN 阶段** (按 AGENTS.md 流程拆任务 + 排期)
