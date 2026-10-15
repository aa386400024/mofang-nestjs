import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { PrivacyGuard } from './guards/privacy.guard';
import { TenantContextMiddleware } from './middleware/tenant-context.middleware';
import { PrivacyLogger } from './privacy/privacy-logger.service';
import * as providers from './providers';
import { SecurityHeadersMiddleware } from './security/security-headers.middleware';
// V2026-10-12 (Phase 8.2 — 多租户, spec §8.3): 全局注入 tenantId.

const services = [...Object.values(providers), PrivacyLogger, PrivacyGuard];

/**
 * CommonModule — 全局公共 providers (ConfigService + UtilService + V1.1 安全层).
 *
 * V1.1 升级: 注册 RSA keypair 服务 + 安全头中间件 (大厂 OWASP P1 标准).
 *   - RsaKeyService: RSA-OAEP 2048bit 字段加密 (password/code 在 client 加密后传输)
 *   - EncryptedFieldsInterceptor: 自动解密 *Enc 字段 (controller 拿到明文)
 *   - SecurityHeadersMiddleware: HSTS + X-Frame-Options + Permissions-Policy 等
 *
 * V2-temp 备注: LoggerContextMiddleware 源码保留, V3 清理 demo 时删除.
 *
 * V2026-10-15 治本 (VS-4 隐私分级 — 注册 PrivacyLogger + PrivacyGuard):
 *   NestJS DI 自动 wire, 0 新依赖. 后续 controller 用
 *   @UseGuards(JwtAuthGuard, PrivacyGuard) @RequirePrivacyLevel(PrivacyLevel.L3_CONFIDENTIAL)
 *   即可生效 (应用留 V1.x 后续 VS).
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
    // V2026-10-12 (Phase 8.2): 全局注入 tenantId, 业务层 @TenantId() 读.
    // 必须在 SecurityHeadersMiddleware 之后 (中间件按声明顺序执行,
    // 后续可能加 TenantAuditMiddleware 在 TenantContext 后记录 audit).
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
