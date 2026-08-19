import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SoftDeleteCron } from './soft-delete.cron';
import { OAuthIdentity } from '../entities/oauth-identity.entity';
import { PasswordHistory } from '../entities/password-history.entity';
import { Session } from '../entities/session.entity';
import { User } from '../entities/user.entity';

import { UserModule } from '../user.module';

/**
 * Cron module — 定时任务 (大厂运维必备).
 *
 * 设计:
 *   - 用 @nestjs/schedule 的 @Cron 装饰器 (基于 node-cron)
 *   - 不需要独立 module, 这里抽出来是为了依赖清晰
 *   - 任务: 软删到期真删 / 清理过期 session / 清理孤立数据
 *
 * 注意:
 *   - 多实例部署时, 用分布式锁 (Redis SETNX) 保证只有一个实例跑 cron
 *     V2 简化: 假设单实例部署, V3 加分布式锁
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, Session, PasswordHistory, OAuthIdentity]),
    UserModule, // SessionService / AuditLogService / MetricsService
  ],
  providers: [SoftDeleteCron],
})
export class UserCronModule {}
