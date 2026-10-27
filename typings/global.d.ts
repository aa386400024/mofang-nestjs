import type { Payload } from '../src/auth';

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
      // V2026-10-08: Voice Gateway 空闲超时 (Phase 3)
      VOICE_SESSION_IDLE_TIMEOUT_MS?: string;
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
