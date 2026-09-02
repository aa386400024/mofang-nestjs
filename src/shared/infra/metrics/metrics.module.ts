import { Global, Module } from '@nestjs/common';

// ⚠️ 必须直接 import 文件, 不能用 barrel '../../../common' (循环依赖陷阱, 详见 redis.module.ts).
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { CommonModule } from '../../../common/common.module';

/**
 * Metrics module — Prometheus 指标 (大厂可观测性).
 *
 * 设计:
 *   - @Global() 让业务模块直接 inject MetricsService
 *   - HttpMetricsInterceptor 在 AppModule 单独注册 (需要 reflect metadata)
 *   - Controller 暴露 /metrics
 *
 * imports 显式声明 CommonModule: MetricsService 注入自定义 ConfigService, @Global() 不保证
 * 实例化顺序, 必须在依赖图里显式声明, 否则启动报 UndefinedDependencyException.
 */
@Global()
@Module({
  imports: [CommonModule],
  controllers: [MetricsController],
  providers: [MetricsService, HttpMetricsInterceptor],
  exports: [MetricsService, HttpMetricsInterceptor],
})
export class MetricsModule {}
