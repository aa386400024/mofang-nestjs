import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserController } from './controllers/user.controller';
import { AuditLog } from './entities/audit-log.entity';
import { OAuthIdentity } from './entities/oauth-identity.entity';
import { PasswordHistory } from './entities/password-history.entity';
import { Session } from './entities/session.entity';
import { User } from './entities/user.entity';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuditLogService } from './providers/audit-log.service';
import { EmailVerificationService } from './providers/email-verification.service';
import { JwtBlacklistService } from './providers/jwt-blacklist.service';
import { PasswordHistoryService } from './providers/password-history.service';
import { PasswordResetService } from './providers/password-reset.service';
import { SessionService } from './providers/session.service';
import { UserService } from './providers/user.service';
import { VerificationCodeService } from './providers/verification-code.service';

/**
 * Parse JWT expiresIn string (e.g. '15m', '7d', '1h') into seconds number.
 * @nestjs/jwt@11 接受 number 或 StringValue 模板字面类型, env 读出来是普通 string, 必须转换.
 * 与 user.service.ts 同步 (后续 V3 抽到 common/utils).
 */
function parseExpiresIn(s: string): number {
  // eslint-disable-next-line sonarjs/single-character-alternation
  const match = /^(\d+)(s|m|h|d|w)$/.exec(s);
  if (!match) {
    return 7 * 24 * 60 * 60;
  }
  const n = Number.parseInt(match[1], 10);
  const unit = match[2];
  const map: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400, w: 604_800 };
  return n * (map[unit] ?? 86_400);
}

/**
 * User module — 心塑 + 魔方共用账号模块 (大厂 monorepo 架构核心 V2).
 *
 * 设计要点 (V2):
 *   - User / Session / AuditLog / PasswordHistory / OAuthIdentity 通过 TypeOrmModule.forFeature 注册
 *   - autoLoadEntities 已经在 AppModule 开启, 不需要手动列 entities
 *   - JwtModule.registerAsync 从 ConfigService 读 secret
 *   - JwtAuthGuard 注册为 provider, 供 controller @UseGuards 使用
 *   - SessionService / AuditLogService / JwtBlacklistService / PasswordHistoryService /
 *     EmailVerificationService / PasswordResetService / VerificationCodeService 都导出供其他模块复用
 *   - 不依赖 auth 示例 module (避免循环依赖)
 *   - OAuthModule 子模块独立 (微信/Google/Apple 三方登录)
 *
 * 依赖外部 (来自 @Global() 模块):
 *   - RedisModule (RedisService) — JWT blacklist / 验证码 / 限流
 *   - QueueModule (AuditLogProcessor) — 异步审计
 *   - EmailModule (EmailService) — 邮件发送
 *   - SmsModule (SmsService) — 短信发送
 *   - MetricsModule (MetricsService) — Prometheus 指标
 *
 * V3 计划:
 *   - psychology module (心塑业务)
 *   - moyin module (魔方业务)
 *   - billing module (共用计费)
 *   - content module (共用内容)
 *   - RBAC (按 app 区分权限)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, Session, AuditLog, PasswordHistory, OAuthIdentity]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const expiresInStr = config.get<string>('jwtExpiresIn') ?? '15m';
        return {
          secret: config.get<string>('jwtSecret'),
          signOptions: { expiresIn: parseExpiresIn(expiresInStr) },
        };
      },
    }),
  ],
  controllers: [UserController],
  providers: [
    UserService,
    SessionService,
    AuditLogService,
    JwtBlacklistService,
    PasswordHistoryService,
    EmailVerificationService,
    PasswordResetService,
    VerificationCodeService,
    JwtAuthGuard,
  ],
  exports: [
    UserService,
    SessionService,
    AuditLogService,
    JwtBlacklistService,
    PasswordHistoryService,
    EmailVerificationService,
    PasswordResetService,
    VerificationCodeService,
    JwtModule,
    // V2026-09-03 治本: 之前只导出了 JwtModule, 但 JwtAuthGuard 漏在 exports 外面.
    // InnerWorldModule (以及 ai-companion / companion / home / life-map 等其它业务模块)
    // 都在 controller 用 @UseGuards(JwtAuthGuard), UserModule 没导出它 → 这些模块的
    // controller 首次被请求时抛 UnknownDependenciesException, BizExceptionFilter 兜底返 code 1000.
    // 表现: register / login (走 auth/guards 那套 passport 版) 不挂, 一旦命中 user/guards/jwt-auth.guard
    // (例如 /inner-world/bootstrap / /practice/* / /home/*) 就 500.
    JwtAuthGuard,
  ],
})
export class UserModule {}
