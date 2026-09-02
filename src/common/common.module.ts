import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import * as providers from './providers';
import { SecurityHeadersMiddleware } from './security/security-headers.middleware';

const services = Object.values(providers);

/**
 * CommonModule — 全局公共 providers (ConfigService + UtilService + V1.1 安全层).
 *
 * V1.1 升级: 注册 RSA keypair 服务 + 安全头中间件 (大厂 OWASP P1 标准).
 *   - RsaKeyService: RSA-OAEP 2048bit 字段加密 (password/code 在 client 加密后传输)
 *   - EncryptedFieldsInterceptor: 自动解密 *Enc 字段 (controller 拿到明文)
 *   - SecurityHeadersMiddleware: HSTS + X-Frame-Options + Permissions-Policy 等
 *
 * V2-temp 备注: LoggerContextMiddleware 源码保留, V3 清理 demo 时删除.
 */
@Global()
@Module({
  providers: services,
  exports: services,
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // SecurityHeadersMiddleware 全局应用, 所有响应都加安全头.
    // .forRoutes('*') 覆盖所有路由.
    consumer.apply(SecurityHeadersMiddleware).forRoutes('*');
  }
}
