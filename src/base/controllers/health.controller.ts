import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorResult,
  HttpHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

import { Public } from '../../common';
import { RedisService } from '../../shared/infra/redis';

/**
 * 健康检查 (大厂标配).
 *
 * V1: 数据库 + HTTP (Terminus)
 * V2: 数据库 + HTTP + Redis (BullMQ 后端)
 *
 * 注意:
 *   - 这是"深度"健康检查 (实际 ping 服务), 适合就绪探针
 *   - Prometheus scrape 走 /metrics (独立的轻量端点)
 *   - 给 LB / k8s 探针的应该是"浅"检查 (只返回 200), V3 加 /healthz (浅) + /readyz (深)
 *
 * https://docs.nestjs.com/recipes/terminus
 */
@Controller()
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private http: HttpHealthIndicator,
    private db: TypeOrmHealthIndicator,
    private redis: RedisService,
  ) {}

  @Public()
  @Get('health')
  @HealthCheck()
  public async check(): Promise<HealthCheckResult> {
    return await this.health.check([
      async (): Promise<HealthIndicatorResult> => this.db.pingCheck('database'),
      async (): Promise<HealthIndicatorResult> => this.http.pingCheck('dns', 'https://1.1.1.1'),
      async (): Promise<HealthIndicatorResult> => {
        // Redis 健康检查 (Ping, <1ms)
        const ok = await this.redis.ping();
        return { 'redis': { status: ok ? 'up' : 'down' } };
      },
    ]);
  }
}