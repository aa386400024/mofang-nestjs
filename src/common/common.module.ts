import { Global, Module } from '@nestjs/common';

import * as providers from './providers';

const services = Object.values(providers);

/**
 * CommonModule — 全局公共 providers (ConfigService + UtilService).
 *
 * V2-temp: 移除 LoggerContextMiddleware (项目示例用, 引了被删的 AuthService).
 * V2 用 pino + 自带 userId context (在 JwtAuthGuard 注入), 不需要 middleware.
 * LoggerContextMiddleware 源码保留在 src/common/middleware/, V3 清理 demo 时删除.
 */
@Global()
@Module({
  providers: services,
  exports: services,
})
export class CommonModule {}
