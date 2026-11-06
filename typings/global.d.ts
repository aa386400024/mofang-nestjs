import type { Payload } from '../src/auth/index.js';

export declare global {
  type AnyObject = Record<string, unknown>;

  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: string;
      PORT?: string;
      SESSION_SECRET?: string;

      DB_TYPE: string;
      DB_HOST: string;
      DB_PORT: string;
      DB_USER: string;
      DB_PASSWORD: string;
      DB_NAME: string;

      JWT_SECRET: string;
      JWT_REFRESH_SECRET: string;
      JWT_EXPIRES_IN?: string;
      JWT_REFRESH_EXPIRES_IN?: string;

      // V2 基础设施
      REDIS_HOST?: string;
      REDIS_PORT?: string;
      REDIS_PASSWORD?: string;
      REDIS_DB?: string;
      REDIS_KEY_PREFIX?: string;

      EMAIL_ENABLED?: string;
      EMAIL_HOST?: string;
      EMAIL_PORT?: string;
      EMAIL_SECURE?: string;
      EMAIL_USER?: string;
      EMAIL_PASS?: string;
      EMAIL_FROM?: string;
      EMAIL_FROM_NAME?: string;

      SMS_ENABLED?: string;
      SMS_PROVIDER?: string;
      SMS_ACCESS_KEY?: string;
      SMS_ACCESS_SECRET?: string;
      SMS_SIGN_NAME?: string;
      SMS_TEMPLATE_CODE?: string;
      SMS_REGION?: string;

      WECHAT_OAUTH_ENABLED?: string;
      WECHAT_APP_ID?: string;
      WECHAT_APP_SECRET?: string;
      WECHAT_CALLBACK_URL?: string;

      GOOGLE_OAUTH_ENABLED?: string;
      GOOGLE_CLIENT_ID?: string;
      GOOGLE_CLIENT_SECRET?: string;
      GOOGLE_CALLBACK_URL?: string;

      APPLE_OAUTH_ENABLED?: string;
      APPLE_CLIENT_ID?: string;
      APPLE_TEAM_ID?: string;
      APPLE_KEY_ID?: string;
      APPLE_PRIVATE_KEY?: string;
      APPLE_CALLBACK_URL?: string;

      PASSWORD_HISTORY_LIMIT?: string;
      PASSWORD_RESET_CYCLE_DAYS?: string;
      PASSWORD_MIN_AGE_MINUTES?: string;
      PASSWORD_MAX_FAILED_ATTEMPTS?: string;
      PASSWORD_LOCKOUT_MINUTES?: string;

      EMAIL_TOKEN_TTL_MIN?: string;
      SMS_CODE_TTL_MIN?: string;
      SMS_CODE_LENGTH?: string;
      SMS_RATE_LIMIT_PER_HOUR?: string;
      PASSWORD_RESET_TOKEN_TTL_MIN?: string;

      SOFT_DELETE_RETENTION_DAYS?: string;
      SOFT_DELETE_CRON?: string;

      METRICS_ENABLED?: string;
      METRICS_PATH?: string;
      // V2026-11-03 治本 (WP26 · P2-3 · /metrics 加鉴权):
      //   抓取端点的独立 token (Bearer). 不声明会直接报 TS4111
      //   (noPropertyAccessFromIndexSignature: 走 @types/node 的 [key: string] 索引签名时
      //    点访问不合法, 必须 bracket 访问) —— 与上面 METRICS_* 同一治本思路.
      METRICS_TOKEN?: string; // 留空 = 没开鉴权 → /metrics 拒绝一切请求 (fail-close)

      // V3 合规模块 (心塑 / 魔方共用同意记录)
      // 服务端升级此版本号 → 强制客户端重弹同意 dialog (后端权威)
      CONSENT_CURRENT_VERSION?: string;

      SENTRY_DSN?: string;
      SENTRY_ENVIRONMENT?: string;
      SENTRY_TRACES_SAMPLE_RATE?: string;
      SENTRY_PROFILES_SAMPLE_RATE?: string;
      CORS_ORIGINS?: string;

      // V2026-10-08 — AI 语音训练系统 (SPEC v0.1).
      //   治本 (noPropertyAccessFromIndexSignature 22 个 TS4111 错):
      //     显式声明到 NodeJS.ProcessEnv 后, default.ts 里 process.env.MINIMAX_API_KEY
      //     等点访问才合法 (否则走 @types/node [key: string] 索引签名, 强制要 bracket
      //     访问). 跟项目里 JWT/REDIS/EMAIL 模式一致, 治本而非 workaround.
      //   19 个 var 一次性声明, 后续不再报错.
      MINIMAX_BASE_URL?: string;
      MINIMAX_API_KEY?: string;
      MINIMAX_LLM_MODEL?: string;
      MINIMAX_LLM_TIMEOUT_MS?: string;
      MINIMAX_LLM_MAX_RETRIES?: string;
      MINIMAX_TTS_MODEL?: string;
      MINIMAX_ASR_TOKEN_SECRET?: string;
      MINIMAX_ASR_TOKEN_TTL_SEC?: string;
      // V2026-10-23 治本 (语音微训练 STT 代理 — 本地可调参数):
      //   上游路径 / 模型名是协议事实 (固定在 counselor/config/practice-asr.config.ts),
      //   这里只声明"本地怎么跑"的可调项.
      MINIMAX_ASR_TIMEOUT_MS?: string; // 上游转写超时, 与 LLM 超时隔离 (spec §2.5)
      MINIMAX_ASR_MAX_FILE_BYTES?: string; // 本地体积上限, 默认与上游一致 (50 MiB)
      MINIMAX_ASR_MAX_DURATION_SEC?: string; // 本地时长上限, 默认与上游一致 (500s)
      // V2026-10-26 治本 (官方音色目录代理 — spec §任务 2):
      //   下面是本轮新增的 2 个 env 键. 不声明会直接报 TS4111
      //   (noPropertyAccessFromIndexSignature: 走 @types/node 的 [key: string] 索引签名时
      //    点访问不合法, 必须 bracket 访问) —— 与上面 MINIMAX_* 同一治本思路:
      //   **显式声明到 ProcessEnv**, 不用 bracket 访问绕过.
      MINIMAX_VOICES_TIMEOUT_MS?: string; // 上游音色目录查询超时 (默认 15s)
      MINIMAX_VOICES_CHECK_TIMEOUT_MS?: string; // 握手里的建议性音色校验超时 (默认 3s)
      MINIMAX_VOICES_CACHE_TTL_MS?: string; // 音色目录内存缓存 TTL (默认 10min)
      // V2026-10-23 治本 (微技能自由练习 — 端点级限流):
      PRACTICE_ASR_RATE_LIMIT_PER_MINUTE?: string; // 单用户每分钟转写次数
      PRACTICE_ASR_RATE_LIMIT_WINDOW_MS?: string; // 限流窗口
      // V2026-10-08: TTS bidi 客户端 + 连接池 (Phase 1.2)
      MINIMAX_TTS_TIMEOUT_MS?: string;
      MINIMAX_TTS_MAX_CONNECTIONS?: string; // 连接池上限, 默认 100
      MINIMAX_TTS_ACQUIRE_TIMEOUT_MS?: string; // acquire 排队超时, 默认 10s
      // V2026-10-23 治本 (v2.0 语音对语音 — 官方 T2A V2 协议重写, spec §3.2/§3.3):
      //   下面是本轮新增的 9 个 env 键. 不声明会直接报 TS4111
      //   (noPropertyAccessFromIndexSignature: 走 @types/node 的 [key: string] 索引签名时
      //    点访问不合法, 必须 bracket 访问) —— 与上面 MINIMAX_* 同一治本思路:
      //   **显式声明到 ProcessEnv**, 不用 bracket 访问绕过.
      //   MINIMAX_TTS_DEFAULT_VOICE / MINIMAX_TTS_MAX_RETRIES 同步删除:
      //     前者是未核实的占位音色 (官方枚举外的 mandarin_female_001), 后者从未被实现消费;
      //     代码侧已无任何引用, 留着声明只会让人以为还能配.
      MINIMAX_TTS_VOICE_ID?: string; // 系统音色 voice_id (必填, 空 = voice 模式直接报错)
      MINIMAX_TTS_LANGUAGE_BOOST?: string; // 语言增强, 默认 Chinese
      MINIMAX_TTS_SPEED?: string; // 语速, 官方值域 [0.5, 2]
      MINIMAX_TTS_VOLUME?: string; // 音量, 官方值域 (0, 10]
      MINIMAX_TTS_PITCH?: string; // 音调, 官方值域 [-12, 12]
      MINIMAX_TTS_SAMPLE_RATE?: string; // 采样率, 官方枚举 8000~44100 (默认 32000)
      MINIMAX_TTS_BITRATE?: string; // 码率, 官方枚举 32000/64000/128000/256000 (仅 mp3 生效)
      MINIMAX_TTS_KEEPALIVE_MS?: string; // 客户端保活 ping 间隔 (官方要求客户端主动 ping 防 2201), 0 = 关闭
      MINIMAX_TTS_MAX_SENTENCE_CHARS?: string; // 单句最大字符数 (超长句强制切, 兼作上游 2204 本地防线)
      // V2026-10-26 治本 (vpt 复盘报告 — pending 兜底上限, spec 任务 6):
      //   会话已结束 + 无报告行 + 距结束超过该时长 → 判定报告生成失败 (parse_error),
      //   避免前端永远停在 pending 一直转圈. 默认 15min (主报告 LLM 正常 30-120s 的 10 倍余量).
      SUPERVISION_REPORT_PENDING_TIMEOUT_MS?: string;
      // V2026-10-27 治本 (空会话与报告生命周期 — 最小可分析量, spec 任务 A):
      //   一场会话的有效对话少于这两个阈值 → 判为空局 (no_content): 不派督导 job,
      //   报告**永远不会**生成. 默认值在 counselor/config/supervision.config.ts (单一真值源),
      //   这里只声明"本地怎么跑"的可调项.
      SUPERVISION_MIN_EFFECTIVE_TURNS?: string;
      SUPERVISION_MIN_EFFECTIVE_CHARS?: string;
      // V2026-10-29 治本 (WP21 — 报告生成 SSE 推送端点):
      //   轮询间隔 (默认 2s) 与连接最长存活 (默认 120s, 超时推 {"status":"timeout"} 关流).
      //   默认值在 counselor/config/supervision.config.ts (单一真值源), 这里只声明"本地怎么跑"的可调项.
      SUPERVISION_REPORT_STREAM_POLL_INTERVAL_MS?: string;
      SUPERVISION_REPORT_STREAM_TIMEOUT_MS?: string;
      // V2026-10-08: Voice Gateway 空闲超时 (Phase 3)
      //
      // ⚠️ 这个键**当前无人消费** (仓库里没有任何地方读 `voice.sessionIdleTimeoutMs`),
      //   它是 Phase 3 留下的死配置. V2026-11-03 (WP23) 新增的
      //   `VOICE_SESSION_IDLE_TIMEOUT_MINUTES` 才是真正生效的那个 (单位: 分钟).
      //   保留声明是为了不破坏任何"按 env 键查文档"的用法, 但**别拿它配超时**.
      VOICE_SESSION_IDLE_TIMEOUT_MS?: string;
      // V2026-11-03 治本 (WP23 · 断线重连追平):
      //   下面是本轮新增的 2 个 env 键 (不声明会报 TS4111 —— 同上治理思路).
      VOICE_SESSION_IDLE_TIMEOUT_MINUTES?: string; // 会话 idle 兜底 (分钟, 默认 120; 非法 → 回退默认)
      VOICE_CATCHUP_MAX_TURNS?: string; // 重连最多补几轮 (默认 20; 非法 → 回退默认)
      // V2026-11-02 治本 (WP22 · 语音对练限流与并发上限):
      //   下面是本轮新增的 2 个 env 键. 不声明会直接报 TS4111
      //   (noPropertyAccessFromIndexSignature: 走 @types/node 的 [key: string] 索引签名时
      //    点访问不合法, 必须 bracket 访问) —— 与上面 VOICE_SESSION_IDLE_TIMEOUT_MS
      //    同一治本思路: **显式声明到 ProcessEnv**, 不用 bracket 访问绕过.
      VOICE_DAILY_TOKEN_BUDGET?: string; // 全局当日 completion token 预算 (0 = 不限制)
      VOICE_MAX_CONCURRENT_PER_USER?: string; // 单用户并发语音会话上限 (本期恒为 1)
      EMBEDDING_PROVIDER_DEV?: string;
      EMBEDDING_PROVIDER_PROD?: string;
      EMBEDDING_API_KEY?: string;
      EMBEDDING_API_KEY_MPLAN?: string;
      EMBEDDING_BGE_URL?: string;
      EMBEDDING_MODEL?: string;
      EMBEDDING_DIM?: string;
      QDRANT_URL?: string;
      QDRANT_API_KEY?: string;
      QDRANT_COLLECTION?: string;
      // V2026-11-03 WP37 (会话摘要参数 · 滚动摘要 + 最终摘要):
      //   下面是会话摘要一族的 3 个 env 键. 显式声明的理由与上面 ENGINE_* 同一治本思路:
      //   **逐个字面量**读 (src/engine-adapters/wiring/session-summary.config.ts),
      //   不用计算键 —— 计算键编译器拦不住, 且 env 覆盖断言 (AST 抽取) 扫不到,
      //   漏写一个键会静默失效.
      //   ⚠️ 参数是**工程种子值, 非临床标定** (待真实对练校准).
      SESSION_SUMMARY_BATCH_SIZE?: string; // 滚动摘要攒批阈值 (默认 3: 攒够 3 轮压一次)
      SESSION_SUMMARY_ROLLING_IMPORTANCE?: string; // 滚动摘要重要度 [0,1] (默认 0.5)
      SESSION_SUMMARY_FINAL_IMPORTANCE?: string; // 最终摘要重要度 [0,1] (默认 0.9)
      // V2026-11-03 治本 (WP26 · P2-13 — 单回合 delta cap 参数):
      //   下面是 WP15 引入的 18 个 env 键 (9 维度 × 上下向).
      //   显式声明的理由与上面 MINIMAX_* / VOICE_* 同一治本思路:
      //   **显式登记到 ProcessEnv**, 不用 bracket / 计算键访问绕过 ——
      //   计算键 (`ENGINE_CAP_${dim}_${direction}`) 编译器拦不住 (TS4111 只管点访问),
      //   属**静默偏离**: 键名散在运行时算出来, 人读代码读不到, env 覆盖断言也扫不到.
      //   现在由适配层 (src/engine-adapters/wiring/delta-cap.config.ts) **逐个字面量**读,
      //   装配成内核的 DeltaCapConfig 端口注入 —— 内核零 process.env.
      ENGINE_CAP_TRUST_UP?: string; // 信任单回合上向 cap (默认 0.2)
      ENGINE_CAP_TRUST_DOWN?: string; // 信任单回合下向 cap (默认 -0.3)
      ENGINE_CAP_SAFETY_UP?: string; // 安全感单回合上向 cap (默认 0.2)
      ENGINE_CAP_SAFETY_DOWN?: string; // 安全感单回合下向 cap (默认 -0.3)
      ENGINE_CAP_BOND_UP?: string; // 纽带感单回合上向 cap (默认 0.2)
      ENGINE_CAP_BOND_DOWN?: string; // 纽带感单回合下向 cap (默认 -0.3)
      ENGINE_CAP_VALENCE_UP?: string; // 情绪效价单回合上向 cap (默认 0.2)
      ENGINE_CAP_VALENCE_DOWN?: string; // 情绪效价单回合下向 cap (默认 -0.3)
      ENGINE_CAP_AROUSAL_UP?: string; // 唤醒度单回合上向 cap (默认 0.2)
      ENGINE_CAP_AROUSAL_DOWN?: string; // 唤醒度单回合下向 cap (默认 -0.2)
      ENGINE_CAP_VERBAL_UP?: string; // 言语阻抗单回合上向 cap (默认 0.2)
      ENGINE_CAP_VERBAL_DOWN?: string; // 言语阻抗单回合下向 cap (默认 -0.2)
      ENGINE_CAP_DEPTH_UP?: string; // 深度阻抗单回合上向 cap (默认 0.2)
      ENGINE_CAP_DEPTH_DOWN?: string; // 深度阻抗单回合下向 cap (默认 -0.2)
      ENGINE_CAP_STYLE_UP?: string; // 风格阻抗单回合上向 cap (默认 0.2)
      ENGINE_CAP_STYLE_DOWN?: string; // 风格阻抗单回合下向 cap (默认 -0.2)
      ENGINE_CAP_POSITIVE_UP?: string; // 正向移情单回合上向 cap (默认 0.15)
      ENGINE_CAP_POSITIVE_DOWN?: string; // 正向移情单回合下向 cap (默认 -0.15)
      ENGINE_CAP_NEGATIVE_UP?: string; // 负向移情单回合上向 cap (默认 0.15)
      ENGINE_CAP_NEGATIVE_DOWN?: string; // 负向移情单回合下向 cap (默认 -0.15)
      ENGINE_CAP_DEPENDENCY_UP?: string; // 依赖单回合上向 cap (默认 0.15)
      ENGINE_CAP_DEPENDENCY_DOWN?: string; // 依赖单回合下向 cap (默认 -0.15)
      // V2026-11-03 治本 (WP34 — P1 人格调节系数):
      //   下面是人格调节算子的 env 键 (4 依恋类型 × 2 系数 + 宜人性 2 项 = 10 个;
      //   WP53 再加 4 依恋类型 × 2 同盟系数 = 8 个 → 本段共 18 个).
      //   显式声明的理由与上面 ENGINE_CAP_* 同一治本思路:
      //   **逐个字面量**读 (src/engine-adapters/wiring/personality-modulator.config.ts),
      //   不用计算键 (`ENGINE_MOD_${style}_${kind}`) —— 计算键编译器拦不住,
      //   且 env 覆盖断言 (AST 抽取) 扫不到, 漏写一个键会静默失效.
      //   装配成内核的 PersonalityModulatorConfig 端口注入 —— 内核零 process.env.
      //   ⚠️ 系数是**工程种子值, 非临床标定** (待真实对练校准).
      ENGINE_MOD_SECURE_TRUST_SCALE?: string; // 安全型 trust 增益系数 (默认 1.0)
      ENGINE_MOD_SECURE_RESIST_SCALE?: string; // 安全型 阻抗倍率 (默认 1.0)
      ENGINE_MOD_SECURE_SAFETY_SCALE?: string; // 安全型 safety 增益系数 (默认 1.0)
      ENGINE_MOD_SECURE_BOND_SCALE?: string; // 安全型 bond 增益系数 (默认 1.0)
      ENGINE_MOD_AVOIDANT_TRUST_SCALE?: string; // 回避型 trust 增益系数 (默认 0.6)
      ENGINE_MOD_AVOIDANT_RESIST_SCALE?: string; // 回避型 阻抗倍率 (默认 1.3)
      ENGINE_MOD_AVOIDANT_SAFETY_SCALE?: string; // 回避型 safety 增益系数 (默认 0.5)
      ENGINE_MOD_AVOIDANT_BOND_SCALE?: string; // 回避型 bond 增益系数 (默认 0.5)
      ENGINE_MOD_ANXIOUS_TRUST_SCALE?: string; // 焦虑型 trust 增益系数 (默认 1.2)
      ENGINE_MOD_ANXIOUS_RESIST_SCALE?: string; // 焦虑型 阻抗倍率 (默认 0.8)
      ENGINE_MOD_ANXIOUS_SAFETY_SCALE?: string; // 焦虑型 safety 增益系数 (默认 0.7)
      ENGINE_MOD_ANXIOUS_BOND_SCALE?: string; // 焦虑型 bond 增益系数 (默认 1.3)
      ENGINE_MOD_DISORGANIZED_TRUST_SCALE?: string; // 混乱型 trust 增益系数 (默认 0.8)
      ENGINE_MOD_DISORGANIZED_RESIST_SCALE?: string; // 混乱型 阻抗倍率 (默认 1.2)
      ENGINE_MOD_DISORGANIZED_SAFETY_SCALE?: string; // 混乱型 safety 增益系数 (默认 0.6)
      ENGINE_MOD_DISORGANIZED_BOND_SCALE?: string; // 混乱型 bond 增益系数 (默认 0.8)
      ENGINE_MOD_AGREEABLENESS_TRUST_SCALE?: string; // 高宜人性的 trust 增益系数 (默认 1.1)
      ENGINE_MOD_AGREEABLENESS_HIGH_THRESHOLD?: string; // 高宜人性阈值 [0,1] (默认 0.7)
      // V2026-11-03 WP42 (咨询同盟三维 · 系数与门槛):
      //   下面是同盟三维 (trust / safety / bond) 的 25 个 env 键
      //   (11 种事件 × 2 维覆写 + 3 个门槛).
      //   显式声明的理由与上面 ENGINE_CAP_* / ENGINE_MOD_* 同一治本思路:
      //   **逐个字面量**读 (src/engine-adapters/wiring/alliance-config.ts),
      //   不用计算键 (`ENGINE_ALLIANCE_${kind}_${dim}`) —— 计算键编译器拦不住,
      //   且 env 覆盖断言 (AST 抽取) 扫不到, 漏写一个键会静默失效.
      //   装配成内核的 AllianceConfig 端口注入 —— 内核零 process.env.
      //   ⚠️ 系数是**工程种子值, 非临床标定** (待真实对练校准).
      ENGINE_ALLIANCE_EMPATHY_SAFETY?: string; // 共情对安全感的单事件增量覆写
      ENGINE_ALLIANCE_EMPATHY_BOND?: string; // 共情对纽带感的单事件增量覆写
      ENGINE_ALLIANCE_ACCEPTANCE_SAFETY?: string; // 接纳对安全感的单事件增量覆写
      ENGINE_ALLIANCE_ACCEPTANCE_BOND?: string; // 接纳对纽带感的单事件增量覆写
      ENGINE_ALLIANCE_NORMALIZATION_SAFETY?: string; // 正常化对安全感的单事件增量覆写
      ENGINE_ALLIANCE_NORMALIZATION_BOND?: string; // 正常化对纽带感的单事件增量覆写
      ENGINE_ALLIANCE_OPEN_PROBE_SAFETY?: string; // 开放探问对安全感的单事件增量覆写
      ENGINE_ALLIANCE_OPEN_PROBE_BOND?: string; // 开放探问对纽带感的单事件增量覆写
      ENGINE_ALLIANCE_AFFIRMATION_SAFETY?: string; // 肯定对安全感的单事件增量覆写
      ENGINE_ALLIANCE_AFFIRMATION_BOND?: string; // 肯定对纽带感的单事件增量覆写
      ENGINE_ALLIANCE_JUDGMENT_SAFETY?: string; // 评判对安全感的单事件增量覆写
      ENGINE_ALLIANCE_JUDGMENT_BOND?: string; // 评判对纽带感的单事件增量覆写
      ENGINE_ALLIANCE_PREACHING_SAFETY?: string; // 说教对安全感的单事件增量覆写
      ENGINE_ALLIANCE_PREACHING_BOND?: string; // 说教对纽带感的单事件增量覆写
      ENGINE_ALLIANCE_MINIMIZING_SAFETY?: string; // 淡化对安全感的单事件增量覆写
      ENGINE_ALLIANCE_MINIMIZING_BOND?: string; // 淡化对纽带感的单事件增量覆写
      ENGINE_ALLIANCE_BOUNDARY_CROSS_SAFETY?: string; // 越界对安全感的单事件增量覆写
      ENGINE_ALLIANCE_BOUNDARY_CROSS_BOND?: string; // 越界对纽带感的单事件增量覆写
      ENGINE_ALLIANCE_SENSITIVE_TOUCH_SAFETY?: string; // 敏感议题触碰对安全感的单事件增量覆写
      ENGINE_ALLIANCE_SENSITIVE_TOUCH_BOND?: string; // 敏感议题触碰对纽带感的单事件增量覆写
      ENGINE_ALLIANCE_NEUTRAL_SAFETY?: string; // 中性事件对安全感的单事件增量覆写
      ENGINE_ALLIANCE_NEUTRAL_BOND?: string; // 中性事件对纽带感的单事件增量覆写
      ENGINE_ALLIANCE_OPEN_THRESHOLD?: string; // 探索门槛 [0,1]: min(信任, 安全感) >= 它才探索 (默认 0.6)
      ENGINE_ALLIANCE_RESIST_TRUST_THRESHOLD?: string; // 抗拒门槛 (信任维) [0,1] (默认 0.4)
      ENGINE_ALLIANCE_RESIST_SAFETY_THRESHOLD?: string; // 抗拒门槛 (安全感维) [0,1] (默认 0.3)
      // V2026-11-03 WP36 (跨会话间隔自然衰减 · 半衰期):
      //   下面是 resume 时对情绪 / 阻抗 / 同盟三维做差异化半衰期回落的 3 个 env 键.
      //   显式声明的理由与上面 ENGINE_CAP_* / ENGINE_MOD_* / ENGINE_ALLIANCE_* 同一治本思路:
      //   **逐个字面量**读 (src/engine-adapters/wiring/session-decay.config.ts),
      //   不用计算键 (`ENGINE_DECAY_${group}_HALF_LIFE_MS`) —— 计算键编译器拦不住,
      //   且 env 覆盖断言 (AST 抽取) 扫不到, 漏写一个键会静默失效.
      //   装配成内核的 SessionDecayConfig 端口注入 —— 内核零 process.env.
      //   ⚠️ 半衰期是**工程种子值, 非临床标定** (待真实对练校准).
      ENGINE_DECAY_EMOTION_HALF_LIFE_MS?: string; // 情绪半衰期 (ms, 默认 7 天)
      ENGINE_DECAY_RESISTANCE_HALF_LIFE_MS?: string; // 阻抗半衰期 (ms, 默认 14 天)
      ENGINE_DECAY_ALLIANCE_HALF_LIFE_MS?: string; // 同盟半衰期 (ms, 默认 30 天)
      // V2026-11-05 治本 (WP32 — BDI 状态持久化):
      //   下面是 BDI 状态存储形态的 2 个 env 键. 显式声明的理由与上面 ENGINE_DECAY_* 同一治本思路:
      //   **逐个字面量**读 (src/engine-adapters/wiring/engine.module.ts), 不用计算键 ——
      //   env 覆盖断言 (AST 抽取) 扫不到计算键, 漏写一个键会静默失效.
      //   装配成"BDI 状态存哪儿"的部署形态决定 (内核零 env 读取, 状态仓储本身在 B 层).
      ENGINE_BDI_STATE_STORE?: string; // BDI 状态存储形态: memory (缺省) | redis (非法值启动期炸)
      ENGINE_BDI_STATE_REDIS_TTL_SECONDS?: string; // Redis 版 TTL 秒数 (默认 604800 = 7 天)
      // V2026-11-05 治本 (WP64 — LLM 审议层 PoC · 影子模式):
      //   下面是影子审议的 4 个 env 键. 显式声明的理由与上面 ENGINE_DECAY_* 同一治本思路:
      //   **逐个字面量**读 (src/engine-adapters/deliberation/llm-deliberation.service.ts),
      //   不用计算键 —— env 覆盖断言 (AST 抽取) 扫不到计算键, 漏写一个键会静默失效.
      //   装配成"审议层的运行参数"注入审议服务 (内核零 env 读取).
      //   ⚠️ 影子模式**默认关** —— 它每轮会多发一次 LLM 请求 (真花钱).
      //   ⚠️ 数值键读到的**一定是字符串** (ConfigService 不做类型转换), 必须自己解析 + 回退默认.
      ENGINE_DELIBERATION_ENABLED?: string; // 影子审议开关: true/1/yes/on 开; 缺省 = 关
      ENGINE_DELIBERATION_MODEL?: string; // 审议专用模型名 (留空 = 用 counselor 域默认模型)
      ENGINE_DELIBERATION_TIMEOUT_MS?: string; // 单次审议超时 (毫秒, 默认 3000; 非法值回退默认)
      ENGINE_DELIBERATION_TEMPERATURE?: string; // 审议采样温度 (默认 0.3; M3.1-Flash 会忽略它)
      // V2026-11-05 治本 (WP65 — 审议影子模式 BullMQ 队列化):
      //   审议 Worker 的并发数. 同样**逐个字面量**读
      //   (src/engine-adapters/deliberation/deliberation.processor.ts).
      //   ⚠️ 数值键读到的**一定是字符串**, 必须自己解析 + 回退默认 (填错一个 env 不该让服务起不来).
      ENGINE_DELIBERATION_WORKER_CONCURRENCY?: string; // 审议 Worker 并发数 (默认 3; 非法值回退默认)
      // V2026-11-05 治本 (WP66 — 审议输出格式校验与重试):
      //   审议的重试次数. 同样**逐个字面量**读
      //   (src/engine-adapters/deliberation/deliberation.processor.ts).
      //   ⚠️ 只在**入队时**读 (attempts 是 job 选项, 入队后固定) —— 开关仍在执行时读.
      ENGINE_DELIBERATION_MAX_RETRIES?: string; // 审议重试次数 (默认 1 = 总共跑 2 次; 非法值回退默认)
      // V2026-11-05 治本 (WP67 — 审议熔断与降级策略):
      //   熔断阈值与冷却时长. 同样**逐个字面量**读
      //   (src/engine-adapters/deliberation/deliberation.processor.ts).
      //   ⚠️ 数值键读到的**一定是字符串**, 必须自己解析 + 回退默认.
      ENGINE_DELIBERATION_FAILURE_THRESHOLD?: string; // 连续失败多少次熔断 (默认 3; 非法值回退默认)
      ENGINE_DELIBERATION_COOLDOWN_MS?: string; // 熔断冷却时长 (毫秒, 默认 600000 = 10 分钟; 非法值回退默认)
      // V2026-11-05 治本 (WP68 — 意图锁定机制):
      //   意图锁定轮数. 同样**逐个字面量**读
      //   (src/engine-adapters/deliberation/llm-deliberation.service.ts).
      //   ⚠️ 数值键读到的**一定是字符串**, 必须自己解析 + 回退默认.
      ENGINE_DELIBERATION_INTENTION_LOCK_ROUNDS?: string; // 锁定几轮 (默认 3; 0 = 关掉锁定; 非法值回退默认)
      // V2026-11-05 治本 (WP58 — 引擎调试面板):
      //   下面是调试面板写接口的 2 个 env 键. 同样**逐个字面量**读
      //   (src/admin-debug/debug-session.service.ts).
      //   ⚠️ 数值键读到的**一定是字符串**, 必须自己解析 + 回退默认.
      // ⚠️ 调试接口**能真跑引擎** (每轮一次 LLM) —— 生产环境缺省必须关.
      ENGINE_DEBUG_CHAT_ENABLED?: string; // 调试面板写接口开关: true/1/yes/on 开; 缺省 = 非生产开 / 生产关
      ENGINE_DEBUG_CHAT_DELIBERATION_WAIT_MS?: string; // 等审议 trace 的上限 (毫秒, 默认 5000; 0 = 不等)
      // V2026-11-06 治本 (WP58 — 事件 + delta 审计观测):
      //   下面是观测通道的开关. 同样**逐个字面量**读
      //   (src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.config.ts).
      //   ⚠️ 缺省 = 关 —— 关着时连分类器都不跑 (零开销).
      TURN_DELTA_AUDIT_ENABLED?: string; // 事件 + delta 审计观测开关: true/1/yes/on 开; 缺省 = 关
    }
  }

  namespace Express {
    interface Request {
      // customProps of pino-http
      customProps: object;
    }
    // V2 治本: 用 `interface User extends Payload {}` 而非 `type User = Payload`.
    //
    // 根因: @types/passport 全局声明了一个空的 `interface User {}` (见
    // node_modules/@types/passport/index.d.ts:7). TypeScript 不允许
    // `type alias` (type User = Payload) 与同名 `interface` 互相覆盖或合并,
    // 它们是两个完全独立的类型 — 旧的写法导致 `req.user` 仍是 passport
    // 那个空 User, 访问 `user.roles` / `user.userId` 触发 TS2339.
    //
    // 治本: 改用 interface declaration merging, 让我们声明的 User 跟 passport
    // 的空 User 在编译期合并, 合并后 User = Payload (userId/username/roles).
    // 这样 req.user?.roles / req.user?.userId 自动具备正确类型推断,
    // 调用方无需 as cast, 也无需重复定义字段 (单一真相源 = Payload).
    interface User extends Payload {}
  }
}
