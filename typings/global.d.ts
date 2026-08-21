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
