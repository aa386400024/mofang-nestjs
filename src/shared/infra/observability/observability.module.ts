import { Global, Module } from '@nestjs/common';

import { SentryService } from './sentry.service';

/**
 * Observability module — Sentry 异常上报 (大厂可观测性).
 *
 * 设计:
 *   - @Global() 让 BizExceptionFilter 自动可用
 *   - BizExceptionFilter 在 5xx 错误时调 SentryService.captureException
 *   - 同步链路: pino logger → stdout → pm2 → ELK / Loki
 *
 * 启用条件:
 *   - SENTRY_DSN 必须设置
 *   - NODE_ENV=production 或 staging
 */
@Global()
@Module({
  providers: [SentryService],
  exports: [SentryService],
})
export class ObservabilityModule {}
