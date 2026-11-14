import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserModule } from '../user/index.js';

import { ConsentController } from './controllers/consent.controller.js';
import { ConsentRepositoryTypeorm } from './data/consent.repository.typeorm.js';
import { CONSENT_REPOSITORY } from './domain/repositories/consent.repository.js';
import { UserConsent } from './entities/user-consent.entity.js';
import { ConsentService } from './providers/consent.service.js';

/**
 * Consent module — 心塑 + 魔方共用合规模块 (大厂企业级 V3).
 *
 * 设计要点:
 *   - UserConsent 走 TypeOrmModule.forFeature 注册 (autoLoadEntities 已开启, 不重复)
 *   - 依赖 UserModule 拿 JwtAuthGuard (bind-to-user 路由用, 不循环依赖, UserModule 不依赖 Consent)
 *   - ConfigModule 用 isGlobal, 这里不重复 import
 *   - ConsentService 导出供其他模块复用 (V3 后续: psychology / moyin 业务可订阅 consent 事件)
 *
 * V2026-11-14 治本 (TD-17 · C2 第一批仓储端口化):
 *   - 新增仓储端口接线 —— service 依赖 token, 不依赖 TypeORM 实现类;
 *     typeorm 值符号只出现在 $data/$ 实现文件与本装配层
 *   - 仓储 token **不 export**: consent 仓储不被跨模块消费 (外部只消费
 *     ConsentService), 不给外部开第二个入口 (对齐 TD-13 D-4 / TD-16)
 *   - $TypeOrmModule.forFeature([UserConsent])$ **保留** (实现层仍需该实体)
 *   - exports 口径不变 ($[ConsentService]$)
 *
 * V3 后续:
 *   - ConsentEventBus (Redis pub/sub) — 协议升级时通知所有在线客户端
 *   - ConsentGuard — 特定路由强制要求特定 consent (e.g. /assessment 必须同意 data_export)
 */
@Module({
  imports: [TypeOrmModule.forFeature([UserConsent]), UserModule],
  controllers: [ConsentController],
  providers: [
    ConsentService,
    // V2026-11-14 治本 (TD-17): 仓储端口接线 —— service 依赖 token, 不依赖实现类.
    {
      provide: CONSENT_REPOSITORY,
      useClass: ConsentRepositoryTypeorm,
    },
  ],
  exports: [ConsentService],
})
export class ConsentModule {}
