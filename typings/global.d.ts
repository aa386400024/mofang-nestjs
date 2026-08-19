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
    interface User extends Payload {}
  }
}