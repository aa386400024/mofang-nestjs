import { Global, Module } from '@nestjs/common';

// ⚠️ 必须直接 import 文件, 不能用 barrel '../../../common'.
// 原因: common/index.ts 的 barrel 会顺带加载 ./filters/biz-exception.filter → ../../shared/infra/observability,
// 与 redis.module.ts 共同形成循环依赖图, NestJS DependenciesScanner 把 CommonModule token 当作 undefined.
// 直接 import common.module.ts 文件, 绕开 barrel 的 side-effect 加载.
import { RedisService } from './redis.service';
import { CommonModule } from '../../../common/common.module';

/**
 * Redis module — 全局基础设施 (心塑 + 魔方共用).
 *
 * 设计:
 *   - @Global() 让其他模块不用重复 imports
 *   - 提供 RedisService 单例 (ioredis 自带连接池)
 *   - 不导出 connection, 由 RedisService 内部管理 (避免散开)
 *
 * 依赖关系:
 *   - ConfigModule (AppModule 全局已注册, 提供 .env 原始数据)
 *   - CommonModule (V2-temp: 提供自定义 ConfigService, 严格 get(), 必须在 imports 显式声明)
 *     原因: @Global() 只控制"可见性", 不保证"实例化顺序". RedisModule 在 AppModule 的 imports
 *     中位于 CommonModule 之前, 必须显式 import CommonModule 让 NestJS 按依赖图先实例化它,
 *     否则 RedisService 构造时找不到自定义 ConfigService token → UndefinedDependencyException.
 *   - 无 DB 依赖, 启动更早 (避免循环依赖)
 */
@Global()
@Module({
  imports: [CommonModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
