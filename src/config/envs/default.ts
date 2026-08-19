export const config = {
  db: {
    // entities: [`${__dirname}/../../entity/**/*.{js,ts}`],
    // subscribers: [`${__dirname}/../../subscriber/**/*.{js,ts}`],
    // migrations: [`${__dirname}/../../migration/**/*.{js,ts}`],
  },
  graphql: {
    debug: true,
    playground: {
      settings: {
        'request.credentials': 'include',
      },
    },
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
    enabled: process.env.METRICS_ENABLED !== 'false', // 默认开启
    path: process.env.METRICS_PATH ?? '/metrics',
    // 默认 HTTP histogram buckets (5ms ~ 10s, 大厂经验值)
    httpDurationBuckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  },
};