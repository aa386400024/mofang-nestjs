import { Global, Module } from '@nestjs/common';

import { RedisService } from './redis.service';

/**
 * Redis module — 全局基础设施 (心塑 + 魔方共用).
 *
 * 设计:
 *   - @Global() 让其他模块不用重复 imports
 *   - 提供 RedisService 单例 (ioredis 自带连接池)
 *   - 不导出 connection, 由 RedisService 内部管理 (避免散开)
 *
 * 依赖关系:
 *   - ConfigModule (AppModule 全局已注册)
 *   - 无 DB 依赖, 启动更早 (避免循环依赖)
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
