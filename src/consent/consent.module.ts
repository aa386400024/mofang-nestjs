import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserModule } from '../user';
import { ConsentController } from './controllers/consent.controller';
import { UserConsent } from './entities/user-consent.entity';
import { ConsentService } from './providers/consent.service';

/**
 * Consent module — 心塑 + 魔方共用合规模块 (大厂企业级 V3).
 *
 * 设计要点:
 *   - UserConsent 走 TypeOrmModule.forFeature 注册 (autoLoadEntities 已开启, 不重复)
 *   - 依赖 UserModule 拿 JwtAuthGuard (bind-to-user 路由用, 不循环依赖, UserModule 不依赖 Consent)
 *   - ConfigModule 用 isGlobal, 这里不重复 import
 *   - ConsentService 导出供其他模块复用 (V3 后续: psychology / moyin 业务可订阅 consent 事件)
 *
 * V3 后续:
 *   - ConsentEventBus (Redis pub/sub) — 协议升级时通知所有在线客户端
 *   - ConsentGuard — 特定路由强制要求特定 consent (e.g. /assessment 必须同意 data_export)
 */
@Module({
  imports: [TypeOrmModule.forFeature([UserConsent]), UserModule],
  controllers: [ConsentController],
  providers: [ConsentService],
  exports: [ConsentService],
})
export class ConsentModule {}
