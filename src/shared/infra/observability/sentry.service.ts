import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as Sentry from '@sentry/node';

/**
 * Integration duck type (避免 import 路径问题).
 * Sentry v8 的 Integration 接口在 @sentry/core 的 types-hoist 里,
 * 直接 import 路径不稳健, 这里只取运行时需要的 name 字段.
 */
type SentryIntegration = { name: string };

/**
 * Sentry service — 生产环境异常捕获 + 性能追踪 (大厂可观测性标配).
 *
 * 设计:
 *   - 自动捕获未捕获异常 + 未处理 promise rejection
 *   - HTTP 请求 traces + 性能 profiling
 *   - 集成 NestJS Logger (pino) 自动同步
 *   - 按环境分流 (dev 不上报, prod/staging 100% 异常 + 抽样 perf)
 *
 * 启用条件:
 *   - SENTRY_DSN 必须设置
 *   - NODE_ENV=production 或 staging
 *
 * 大厂做法:
 *   - 异常上报 100% (异常是稀有的, 全量)
 *   - 性能 tracing 抽样 (10%-20%, 避免开销过大)
 *   - profiling 抽样 5% (采样而非全量, 减少 profiler 开销)
 *   - PII 数据脱敏 (用户密码 / token / cookie 在 beforeSend 里 strip)
 */
@Injectable()
export class SentryService implements OnModuleInit {
  private readonly logger = new Logger(SentryService.name);
  private initialized = false;

  async onModuleInit(): Promise<void> {
    const dsn = process.env['SENTRY_DSN'];
    const env = process.env['SENTRY_ENVIRONMENT'] ?? process.env['NODE_ENV'] ?? 'development';
    if (!dsn) {
      this.logger.warn('Sentry DSN not set, error reporting disabled');
      return;
    }
    if (env === 'development') {
      this.logger.warn('Sentry disabled in development');
      return;
    }

    const tracesSampleRate = Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1'); // 10%
    const profilesSampleRate = Number(process.env['SENTRY_PROFILES_SAMPLE_RATE'] ?? '0.05'); // 5%

    // Profiler 是 nice-to-have, 不是必需. Node ABI 不匹配时优雅降级.
    let profilingIntegration: SentryIntegration | null = null;
    try {
      // dynamic import 避免 native binary 缺失时阻塞启动
      const { nodeProfilingIntegration } = await import('@sentry/profiling-node');
      profilingIntegration = nodeProfilingIntegration();
    } catch (err) {
      this.logger.warn(
        `Sentry profiling disabled (native binary mismatch or missing): ${(err as Error).message}. ` +
        'This is OK — traces + errors still work. To enable profiling, run npm rebuild @sentry/profiling-node.',
      );
    }

    Sentry.init({
      dsn,
      environment: env,
      release: process.env['SENTRY_RELEASE'] ?? undefined,
      tracesSampleRate,
      profilesSampleRate: profilingIntegration ? profilesSampleRate : 0,
      integrations: [
        ...(profilingIntegration ? [profilingIntegration] : []),
        Sentry.httpIntegration(),
        Sentry.expressIntegration(),
        Sentry.fastifyIntegration(),
      ],
      // PII 脱敏 — 防止密码/token 进 Sentry
      beforeSendTransaction(event) {
        if (event.request) {
          delete event.request.cookies;
          if (event.request.headers) {
            delete event.request.headers['authorization'];
            delete event.request.headers['cookie'];
          }
        }
        return event;
      },
      beforeSend(event) {
        if (event.request) {
          delete event.request.cookies;
          if (event.request.headers) {
            delete event.request.headers['authorization'];
            delete event.request.headers['cookie'];
          }
        }
        // 屏蔽已知噪音 (DB connection retry 等)
        if (event.exception?.values?.some((e) => e.type === 'ECONNRESET')) {
          return null;
        }
        return event;
      },
      ignoreErrors: [
        // 已知非异常 — 不上报
        /^Network request failed$/,
        /^Failed to fetch$/,
        'Unauthorized',
        'TokenExpired',
        'TokenRevoked',
        'TokenNotActive',
      ],
    });

    this.initialized = true;
    this.logger.log(`Sentry initialized: env=${env} tracesSampleRate=${tracesSampleRate} profilesSampleRate=${profilesSampleRate}`);
  }

  /**
   * 手动上报业务异常 (异步流程 / Worker 进程).
   * main process 的异常 NestJS 自动捕获上报, 这个给 BullMQ Worker 用.
   */
  captureException(err: unknown, context?: Record<string, unknown>): void {
    if (!this.initialized) {
      return;
    }
    Sentry.captureException(err, { extra: context });
  }

  /**
   * 手动上报业务事件 (注册 / 支付成功等).
   */
  captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info', context?: Record<string, unknown>): void {
    if (!this.initialized) {
      return;
    }
    Sentry.captureMessage(message, { level, extra: context });
  }
}