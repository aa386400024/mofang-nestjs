import { Global, Module } from '@nestjs/common';

import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * Metrics module — Prometheus 指标 (大厂可观测性).
 *
 * 设计:
 *   - @Global() 让业务模块直接 inject MetricsService
 *   - HttpMetricsInterceptor 在 AppModule 单独注册 (需要 reflect metadata)
 *   - Controller 暴露 /metrics
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, HttpMetricsInterceptor],
  exports: [MetricsService, HttpMetricsInterceptor],
})
export class MetricsModule {}