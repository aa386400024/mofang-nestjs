// V2026-10-27 治本 (督导阈值单一真值源):
//   下面 `supervision` 段的三个阈值来自 counselor 的 config 模块 (业务口径的归属地),
//   env 只是**覆盖入口** —— 默认值不在这里重复写一份字面量 (两处各写一份必然漂移).
import {
  SUPERVISION_MIN_EFFECTIVE_CHARS,
  SUPERVISION_MIN_EFFECTIVE_TURNS,
  SUPERVISION_REPORT_PENDING_TIMEOUT_MS,
  SUPERVISION_REPORT_STREAM_POLL_INTERVAL_MS,
  SUPERVISION_REPORT_STREAM_TIMEOUT_MS,
} from '../../counselor/config/supervision.config.js';

export const config = {
  db: {},
  graphql: {
    debug: true,
    graphiql: true,
    autoSchemaFile: true,
    autoTransformHttpErrors: true,
    // cors: { credentials: true },
    // sortSchema: true,
    // installSubscriptionHandlers: true,
  },
  hello: 'world',
  jwtSecret: process.env.JWT_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN,
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
  // Redis — 大厂基础设施: JWT blacklist / BullMQ 队列 / 验证码 / 限流 / 缓存
  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD,
    db: Number(process.env.REDIS_DB ?? 0),
    // BullMQ 要求 maxRetriesPerRequest=null (官方推荐配置)
    bullMaxRetriesPerRequest: null,
    // key 前缀 (多环境隔离)
    keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'mofang',
  },
  // 邮件 — SMTP 协议 (生产: 阿里云邮件推送 / SendGrid / Mailgun)
  email: {
    enabled: process.env.EMAIL_ENABLED === 'true',
    host: process.env.EMAIL_HOST ?? 'smtp.example.com',
    port: Number(process.env.EMAIL_PORT ?? 465),
    secure: process.env.EMAIL_SECURE !== 'false', // 默认 true (SSL)
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    from: process.env.EMAIL_FROM ?? 'noreply@mofang.cloud',
    fromName: process.env.EMAIL_FROM_NAME ?? 'Mofang',
  },
  // 短信 — 验证码通道 (生产: 阿里云 / 腾讯云 / Twilio)
  sms: {
    enabled: process.env.SMS_ENABLED === 'true',
    provider: process.env.SMS_PROVIDER ?? 'mock', // 'mock' | 'aliyun' | 'tencent' | 'twilio'
    accessKey: process.env.SMS_ACCESS_KEY,
    accessSecret: process.env.SMS_ACCESS_SECRET,
    signName: process.env.SMS_SIGN_NAME ?? 'Mofang',
    templateCode: process.env.SMS_TEMPLATE_CODE,
    region: process.env.SMS_REGION,
  },
  // OAuth 第三方登录
  oauth: {
    wechat: {
      enabled: process.env.WECHAT_OAUTH_ENABLED === 'true',
      appId: process.env.WECHAT_APP_ID,
      appSecret: process.env.WECHAT_APP_SECRET,
      callbackUrl: process.env.WECHAT_CALLBACK_URL ?? 'http://localhost:3000/user/oauth/wechat/callback',
    },
    google: {
      enabled: process.env.GOOGLE_OAUTH_ENABLED === 'true',
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackUrl: process.env.GOOGLE_CALLBACK_URL ?? 'http://localhost:3000/user/oauth/google/callback',
    },
    apple: {
      enabled: process.env.APPLE_OAUTH_ENABLED === 'true',
      clientId: process.env.APPLE_CLIENT_ID,
      teamId: process.env.APPLE_TEAM_ID,
      keyId: process.env.APPLE_KEY_ID,
      privateKey: process.env.APPLE_PRIVATE_KEY, // PEM 字符串
      callbackUrl: process.env.APPLE_CALLBACK_URL ?? 'https://mofang.cloud/user/oauth/apple/callback',
    },
  },
  // 密码策略 (大厂生产标准, NIST 800-63B + 国内合规)
  password: {
    historyLimit: Number(process.env.PASSWORD_HISTORY_LIMIT ?? 5), // 不允许复用最近 N 次
    resetCycleDays: Number(process.env.PASSWORD_RESET_CYCLE_DAYS ?? 90), // 强制重置周期
    minAgeMinutes: Number(process.env.PASSWORD_MIN_AGE_MINUTES ?? 0), // 改密最小间隔 (0 = 不限)
    maxFailedAttempts: Number(process.env.PASSWORD_MAX_FAILED_ATTEMPTS ?? 5), // 失败锁定阈值
    lockoutMinutes: Number(process.env.PASSWORD_LOCKOUT_MINUTES ?? 30), // 锁定时长
  },
  // 验证码 (通用配置)
  verification: {
    emailTokenTtlMin: Number(process.env.EMAIL_TOKEN_TTL_MIN ?? 30), // 邮箱验证 token 有效期
    smsCodeTtlMin: Number(process.env.SMS_CODE_TTL_MIN ?? 5), // 短信验证码有效期
    smsCodeLength: Number(process.env.SMS_CODE_LENGTH ?? 6), // 短信验证码长度
    smsRateLimitPerHour: Number(process.env.SMS_RATE_LIMIT_PER_HOUR ?? 10), // 每手机号每小时最多发 N 条
    passwordResetTokenTtlMin: Number(process.env.PASSWORD_RESET_TOKEN_TTL_MIN ?? 60), // 密码重置 token 有效期
  },
  // Soft delete — 大厂 GDPR 合规
  softDelete: {
    retentionDays: Number(process.env.SOFT_DELETE_RETENTION_DAYS ?? 30), // 30 天后真删
    cronSchedule: process.env.SOFT_DELETE_CRON ?? '0 3 * * *', // 每天凌晨 3 点跑
  },
  // Prometheus metrics
  metrics: {
    // V2026-11-03 治本 (WP26 · P2-3 · /metrics 加鉴权):
    //   旧口径 `process.env.METRICS_ENABLED !== 'false'` = **缺省即开**, 且端点零鉴权 ——
    //   等于把 QPS / 延迟分位 / 错误率直接挂在网上 (WP25 报告 P2-3).
    //   新口径 (fail-close):
    //     · 显式配了 METRICS_ENABLED → 照配的走, 但**只有 'true' 算开**;
    //     · 没配 (或只配了空串)      → 生产**关** (NODE_ENV=production), 非生产开 (本地调试方便).
    //   为什么"生产缺省关"写在**共享的 default.ts** 而不是 production.ts:
    //     default.ts 是三份 env (development / test / production) 共用的底座, 加载顺序是
    //     default → ${NODE_ENV}; 生产实际跑的就是 production.ts + default.ts,
    //     缺省值落在哪一层生效结果一样 —— 写在共享层就不用碰另外两份 env 文件
    //     (改动面最小, 也不会跟别的任务单的并行改动打架).
    //   ⚠️ 生产真的要看指标: 显式 METRICS_ENABLED=true **且** 配 METRICS_TOKEN,
    //     两者缺一不可 (token 没配 = 拒绝一切请求, 见 metrics.controller.ts).
    enabled: resolveMetricsEnabled(),
    path: process.env.METRICS_PATH ?? '/metrics',
    // 抓取端点的独立 token (Bearer). 留空 = 没开鉴权 → 端点拒绝一切请求 (fail-close).
    // 为什么用 token 而不是内网 IP 白名单:
    //   · 生产开了 `app.enable('trust proxy')` (src/app.ts:43), Express 的 req.ip 取自
    //     X-Forwarded-For —— 客户端可伪造该头, 基于它的白名单在"应用端口能被直连"时形同虚设;
    //   · 仓库没有 CIDR 匹配库, 手写 CIDR 判定 = 自己造一遍边界坑;
    //   · Prometheus 原生支持 bearer token (authorization.credentials / bearer_token_file),
    //     抓取侧零改造, token 还能随时轮换.
    token: process.env.METRICS_TOKEN,
    // 默认 HTTP histogram buckets (5ms ~ 10s, 大厂经验值)
    httpDurationBuckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  },
  // V3 合规模块 (心塑 / 魔方共用同意记录)
  // 通过升级此版本号, 服务端强制客户端重弹同意 dialog (后端权威)
  consent: {
    currentVersion: process.env.CONSENT_CURRENT_VERSION ?? 'v1.0',
  },
  // V2026-10-08 治本 (AI 语音训练系统 — SPEC v0.1, Phase 1.1):
  //   - 凭证仅放服务端, 客户端用短期 OAuth token 直连 ASR (见 §9.2)
  //   - baseUrl / model / timeout / maxRetries 都可 env 覆盖 (生产调优)
  //   - apiKey 必须 env 注入, 不在代码里硬编码, 也不写 default
  minimax: {
    baseUrl: process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.cn',
    apiKey: process.env.MINIMAX_API_KEY,
    llmModel: process.env.MINIMAX_LLM_MODEL ?? 'MiniMax-M3',
    llmTimeoutMs: Number(process.env.MINIMAX_LLM_TIMEOUT_MS ?? 30_000),
    llmMaxRetries: Number(process.env.MINIMAX_LLM_MAX_RETRIES ?? 2),
    // V2026-10-23 治本 (v2.0 语音对语音 — TTS bidi 按官方 T2A V2 协议重写, spec §3.1/§3.2/§3.3):
    //   模型: 官方枚举只有 turbo / hd 后缀, 旧的 `speech-2.8` **不存在** (必然 2013).
    //   音色: 旧的 `mandarin_female_001` 是未核实占位值, **不得当可用值上线** ——
    //     因此这里不给默认值: 未配置时上层 fail-fast 报错, 不用占位音色顶替.
    ttsModel: process.env.MINIMAX_TTS_MODEL ?? 'speech-2.8-turbo',
    ttsVoiceId: process.env.MINIMAX_TTS_VOICE_ID ?? '',
    ttsLanguageBoost: process.env.MINIMAX_TTS_LANGUAGE_BOOST ?? 'Chinese',
    ttsSpeed: Number(process.env.MINIMAX_TTS_SPEED ?? 1),
    ttsVolume: Number(process.env.MINIMAX_TTS_VOLUME ?? 1),
    ttsPitch: Number(process.env.MINIMAX_TTS_PITCH ?? 0),
    ttsSampleRate: Number(process.env.MINIMAX_TTS_SAMPLE_RATE ?? 32_000),
    ttsBitrate: Number(process.env.MINIMAX_TTS_BITRATE ?? 128_000),
    // V2026-10-08: TTS bidi 连接池配置 (Phase 1.2)
    ttsTimeoutMs: Number(process.env.MINIMAX_TTS_TIMEOUT_MS ?? 30_000),
    ttsMaxConnections: Number(process.env.MINIMAX_TTS_MAX_CONNECTIONS ?? 100),
    ttsAcquireTimeoutMs: Number(process.env.MINIMAX_TTS_ACQUIRE_TIMEOUT_MS ?? 10_000),
    // V2026-10-23 治本: 保活 ping 间隔 (官方不主动 ping, 120s 空闲会被以 2201 断开);
    //   0 = 关闭保活 (单轮短对话可不保活)
    ttsKeepaliveMs: Number(process.env.MINIMAX_TTS_KEEPALIVE_MS ?? 30_000),
    // V2026-10-23 治本: 单句最大字符数 (超长句强制切, 兼作上游 2204 的本地防线)
    ttsMaxSentenceChars: Number(process.env.MINIMAX_TTS_MAX_SENTENCE_CHARS ?? 100),
    // ASR (Phase 1.3 客户端直连, 这里存服务端 proxy / token 签发用)
    asrTokenSecret: process.env.MINIMAX_ASR_TOKEN_SECRET,
    asrTokenTtlSec: Number(process.env.MINIMAX_ASR_TOKEN_TTL_SEC ?? 300), // 5min
    // V2026-10-23 治本 (语音微训练 STT 代理 — spec §2.3 / §2.5):
    //   上游路径 / 模型名是**协议事实**, 固定在 counselor/config/practice-asr.config.ts,
    //   这里只放"本地怎么跑"的可调参数 (超时 / 本地更严的体积与时长上限).
    //   协议事实做成 env 会导致"换上游站点"变成改配置, 静默走错站 —— 不治本.
    asrTimeoutMs: Number(process.env.MINIMAX_ASR_TIMEOUT_MS ?? 30_000),
    asrMaxFileBytes: Number(process.env.MINIMAX_ASR_MAX_FILE_BYTES ?? 52_428_800), // 50 MiB, 与上游硬限制一致
    asrMaxDurationSec: Number(process.env.MINIMAX_ASR_MAX_DURATION_SEC ?? 500), // 与上游硬限制一致
    // V2026-10-26 治本 (官方音色目录代理 — spec §任务 2):
    //   上游路径 / 音色类型枚举是**协议事实**, 固定在 counselor/config/voices.config.ts,
    //   这里只放"本地怎么跑"的可调参数 (超时 / 内存缓存 TTL).
    //   TTL 默认 10 分钟: 官方系统音色表几乎不变, 低频变动用短 TTL 足够, 又不至于每次
    //   进准备页都打上游.
    voicesTimeoutMs: Number(process.env.MINIMAX_VOICES_TIMEOUT_MS ?? 15_000),
    // V2026-10-26 治本 (spec §任务 1 — 建议性校验不能久等):
    //   WS 握手里的 "voiceId 在不在可用音色内" 是**建议性**校验 (判不出来就放行),
    //   它跑在握手关键路径上 —— 上游卡住 = 整场会谈卡在"连接中".
    //   所以它走一个**更短**的超时, 与 REST 端点的 15s 分开.
    voicesCheckTimeoutMs: Number(process.env.MINIMAX_VOICES_CHECK_TIMEOUT_MS ?? 3000),
    voicesCacheTtlMs: Number(process.env.MINIMAX_VOICES_CACHE_TTL_MS ?? 600_000),
  },
  // V2026-10-23 治本 (微技能自由练习 — 端点级运营参数):
  //   练习域的限流阈值独立于全站默认限流 (全局是 IP 级 60 次/分钟),
  //   STT 端点要的是"按 userId 的转写次数" —— 见 practice-asr.throttler.ts.
  practice: {
    asrRateLimitPerMinute: Number(process.env.PRACTICE_ASR_RATE_LIMIT_PER_MINUTE ?? 10),
    asrRateLimitWindowMs: Number(process.env.PRACTICE_ASR_RATE_LIMIT_WINDOW_MS ?? 60_000),
  },
  // V2026-10-26 治本 (vpt 复盘报告 — pending 兜底上限, spec 任务 6):
  //   主报告是**异步**生成的 (BullMQ + LLM), 而失败路径有几种"不留下任何行"的情况
  //   (worker 没跑 / job 重试用尽 / 落库失败) —— 查询侧若永远返回 pending,
  //   前端就会一直转圈, 用户分不清"再等等"和"生成不出来".
  //   这里给一个"陈旧 pending"判定阈值: 会话已结束 + 无报告行 + 距结束超过该时长
  //   → 判定为生成失败 (parse_error).
  //
  // V2026-10-27 治本 (spec 任务 E — 15min → 5min):
  //   正常失败路径已由"失败终态主动落 parse_error"覆盖 (spec 任务 D2), 墙钟兜底只兜
  //   "worker 没跑 / 落库失败"这类漏网 → 阈值从 15min 降到 5min: 5 分钟是主报告
  //   LLM 正常耗时 (30-120s) 的 2.5-10 倍余量, 不会把"慢"误判成"失败",
  //   也不会让学员盯着转圈 15 分钟.
  supervision: {
    reportPendingTimeoutMs: Number(process.env.SUPERVISION_REPORT_PENDING_TIMEOUT_MS ?? SUPERVISION_REPORT_PENDING_TIMEOUT_MS),
    // V2026-10-27 治本 (spec 任务 A/D2 — 最小可分析量):
    //   一场会话的有效对话少于这两个阈值 → 判为空局 (no_content): 不派督导 job,
    //   报告**永远不会**生成. 阈值可配 (运营能按内容密度调整), 不写死在判定里.
    minEffectiveTurns: Number(process.env.SUPERVISION_MIN_EFFECTIVE_TURNS ?? SUPERVISION_MIN_EFFECTIVE_TURNS),
    minEffectiveChars: Number(process.env.SUPERVISION_MIN_EFFECTIVE_CHARS ?? SUPERVISION_MIN_EFFECTIVE_CHARS),
    // V2026-10-29 治本 (WP21 — 报告 SSE 推送端点):
    //   前端改成"先 GET 判断、pending 时开 SSE 等推送", 报告到达的延迟改由**服务端轮询**
    //   决定: 轮询间隔 2s (用户无感) + 连接最长存活 120s (超时即推 timeout 收口).
    //   这两个值是**连接侧**参数, 与上面的 reportPendingTimeoutMs (查询侧状态派生兜底)
    //   不是一回事 —— 后者 5min, 前者必须短 (连接久悬不关 = 服务端资源白占).
    reportStreamPollIntervalMs: Number(
      process.env.SUPERVISION_REPORT_STREAM_POLL_INTERVAL_MS ?? SUPERVISION_REPORT_STREAM_POLL_INTERVAL_MS,
    ),
    reportStreamTimeoutMs: Number(process.env.SUPERVISION_REPORT_STREAM_TIMEOUT_MS ?? SUPERVISION_REPORT_STREAM_TIMEOUT_MS),
  },
  // V2026-10-08: Voice Gateway 业务配置 (Phase 3)
  voice: {
    sessionIdleTimeoutMs: Number(process.env.VOICE_SESSION_IDLE_TIMEOUT_MS ?? 600_000), // 10min
    // V2026-11-03 治本 (WP23 · 断线重连追平):
    //   · sessionIdleTimeoutMinutes: 超长 idle 兜底 (单位**分钟**, 默认 120).
    //     语义: "从最后一次收到客户端消息算起, 超过这么久没收到任何上行 → 主动 endSession".
    //     它是**内存卫生兜底**, 不是断连宽限期 —— 断连不挂任何定时器 (任务单 §1.1).
    //   · catchUpMaxTurns: 重连时最多补几轮 (默认 20). 漏的轮次超过它就不补,
    //     推 `session_stale`, 让客户端自己从头开始.
    //   ⚠️ 两个值都走 `readPositiveNumber`: env 缺失 / 非法 / 非正数 → 回退默认.
    //     照用非法值比"没有这个兜底"更糟: 0 或负数会让 idle 兜底**立刻**触发
    //     (会话秒死), NaN 会让比较永远为假 (兜底形同虚设).
    sessionIdleTimeoutMinutes: readPositiveNumber(process.env.VOICE_SESSION_IDLE_TIMEOUT_MINUTES, 120),
    catchUpMaxTurns: readPositiveNumber(process.env.VOICE_CATCHUP_MAX_TURNS, 20),
    // V2026-11-02 治本 (WP22 · 语音对练限流与并发上限):
    //   - dailyTokenBudget: 全局**当日** completion token 预算 (0 = 不限制).
    //     内测期防"bug 循环 / 恶意刷"烧 MiniMax 按量付费额度.
    //   - maxConcurrentPerUser: 单用户并发语音会话上限 (本期恒为 1;
    //     留这个 env 是为了以后放开时不必改代码结构).
    dailyTokenBudget: Number(process.env.VOICE_DAILY_TOKEN_BUDGET ?? 500_000),
    maxConcurrentPerUser: Number(process.env.VOICE_MAX_CONCURRENT_PER_USER ?? 1),
  },
  // V2026-10-08 治本 (Embedding 服务, Phase 6 接入):
  //   - provider 切换不改 schema (bge / chatanywhere 都是 1024 维)
  //   - 用户已提供 2 个 chatanywhere key, 通过 EMBEDDING_API_KEY / EMBEDDING_API_KEY_MPLAN env 注入
  //   - bge 自托管 URL 走容器内网, 生产推荐
  embedding: {
    providerDev: process.env.EMBEDDING_PROVIDER_DEV ?? 'chatanywhere',
    providerProd: process.env.EMBEDDING_PROVIDER_PROD ?? 'bge_large_zh',
    chatanywhereApiKey: process.env.EMBEDDING_API_KEY,
    chatanywhereMplanKey: process.env.EMBEDDING_API_KEY_MPLAN,
    bgeUrl: process.env.EMBEDDING_BGE_URL ?? 'http://bge-embedding.internal:8080',
    model: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
    dim: Number(process.env.EMBEDDING_DIM ?? 1024),
  },
  // V2026-10-08 治本 (Qdrant 向量库, Phase 6 接入):
  //   - 跟 NestJS 同京东云 ECS, 内网 http, 0 边际成本
  //   - apiKey 走 env, 生产建议开
  qdrant: {
    url: process.env.QDRANT_URL ?? 'http://qdrant:6333',
    apiKey: process.env.QDRANT_API_KEY,
    collection: process.env.QDRANT_COLLECTION ?? 'knowledge_chunks',
  },
};

/**
 * 读一个**正数** env (缺失 / 非法 / 非正数 → 回退缺省值).
 *
 * 为什么不用 `Number(x ?? fallback)`:
 *   `Number('abc')` → NaN, `Number('0')` → 0 —— 两者都会**照用**:
 *   NaN 让所有比较为假 (兜底形同虚设), 0 让兜底**立刻**触发 (会话秒死).
 *   这类"照用比没有更糟"的参数, 必须在**解析层**就回退.
 *
 * @param raw env 原始值
 * @param fallback 缺省值
 * @returns 合法正数; 否则返回缺省值
 */
function readPositiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/**
 * 解析 /metrics 开关 (WP26 · P2-3 · /metrics 加鉴权).
 *
 * 口径 (fail-close —— "配错"必须落在"关", 不能落在"开"):
 *   · 显式值: **只有 'true'** (忽略大小写与前后空白) 算**开**;
 *     其余 ('false' / 'yes' / '1' / 拼错) 一律按**关** ——
 *     这是一个对外端点, "配错变抓不到" (看得见的故障) 远比 "配错就裸奔" (看不见的泄漏) 安全;
 *   · 缺省 (没配 / 只配了空串): 生产**关**, 非生产**开** (本地调试要随时能看指标).
 *
 * @returns /metrics 是否启用
 */
function resolveMetricsEnabled(): boolean {
  const raw = process.env.METRICS_ENABLED?.trim();
  if (raw === undefined || raw === '') {
    return process.env.NODE_ENV !== 'production';
  }
  return raw.toLowerCase() === 'true';
}
