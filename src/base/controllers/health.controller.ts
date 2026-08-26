import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckResult, HealthCheckService, HealthIndicatorResult, TypeOrmHealthIndicator } from '@nestjs/terminus';

import { Public } from '../../common';
import { RedisService } from '../../shared/infra/redis';

/**
 * 健康检查 (大厂标配).
 *
 * V3: 数据库 + Redis (生产可达依赖)
 *
 * V2 依赖公网 1.1.1.1 测 DNS, 服务器/VPC 无公网访问时返 503.
 * V3 治本: 只检测生产真正依赖 (db / redis), 不依赖外网.
 *
 * 大厂原则:
 *   - 健康检查 = "服务能不能正常工作的关键依赖"
 *   - 不依赖公网 (生产环境可能隔离)
 *   - 不依赖其他 microservice (别造成雪崩)
 *   - "浅"检查 vs "深"检查: /healthz 返 200, /readyz 查依赖. V4 拆.
 *
 * https://docs.nestjs.com/recipes/terminus
 */
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get('health')
  @HealthCheck()
  public async check(): Promise<HealthCheckResult> {
    return await this.health.check([
      async (): Promise<HealthIndicatorResult> => this.db.pingCheck('database'),
      async (): Promise<HealthIndicatorResult> => {
        // Redis 健康检查 (Ping, <1ms)
        const ok = await this.redis.ping();
        return { redis: { status: ok ? 'up' : 'down' } };
      },
    ]);
  }
}
