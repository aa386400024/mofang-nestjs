import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RolesGuard } from '../common/guards/roles.guard.js';
import { UserModule } from '../user/user.module.js';

import { CertificationController } from './controllers/certification.controller.js';
import { CompanionController } from './controllers/companion.controller.js';
import { ExportController } from './controllers/export.controller.js';
import { PrivacyAuthorizationController } from './controllers/privacy-authorization.controller.js';
import { ProfileController } from './controllers/profile.controller.js';
import { BurnoutSettings } from './entities/burnout-settings.entity.js';
import { Certification } from './entities/certification.entity.js';
import { CompanionBinding } from './entities/companion-binding.entity.js';
import { CompanionRecord } from './entities/companion-record.entity.js';
import { ConsentSignature } from './entities/consent-signature.entity.js';
import { Membership } from './entities/membership.entity.js';
import { NotificationSettings } from './entities/notification-settings.entity.js';
import { PrivacyAuthorization } from './entities/privacy-authorization.entity.js';
import { SelfcareRecord } from './entities/selfcare-record.entity.js';
import { UserProfile } from './entities/user-profile.entity.js';

import { BurnoutSettingsService } from './providers/burnout-settings.service.js';
import { CertificationService } from './providers/certification.service.js';
import { CompanionBindingService } from './providers/companion-binding.service.js';
import { CompanionRecordService } from './providers/companion-record.service.js';
import { ConsentService } from './providers/consent.service.js';
import { ExportService } from './providers/export.service.js';
import { GrowthReportService } from './providers/growth-report.service.js';
import { MembershipService } from './providers/membership.service.js';
import { NotificationSettingsService } from './providers/notification-settings.service.js';
import { PrivacyAuthorizationService } from './providers/privacy-authorization.service.js';
import { ProfileService } from './providers/profile.service.js';
import { SelfcareRecordService } from './providers/selfcare-record.service.js';
import { User } from '../user/entities/user.entity.js';

/**
 * Profile module — 心塑「我的」Tab V2.0 二级页 (大厂企业级 V3).
 *
 * 设计:
 *   - 11 entity 全部通过 TypeOrmModule.forFeature 注册 (V2026-08-28 +2: privacy_authorizations 走这里)
 *   - 依赖 UserModule 拿 JwtAuthGuard (复用 user 模块鉴权, 不重复造轮子)
 *   - 复用 CommonModule 的 RolesGuard (双角色 endpoint 角色校验)
 *   - 12 service 全部导出 (V3 业务扩展可直接复用, 不用重新 import entity)
 *
 * V2026-08-28 增强:
 *   - 加 ExportService / ExportController (数据导出 + 一键删除)
 *   - 加 PrivacyAuthorizationService / Controller (授权管理)
 *
 * V3 计划:
 *   - 接 EventBus 触发 audit log / 多端推送
 *   - 暴露 CompanionBinding / SelfcareRecord 给心理业务 (推荐 / 危险干预流)
 *   - 接 BullMQ 跑批 (burnout 预警 / membership 过期扫描 / export zip)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserProfile,
      NotificationSettings,
      Membership,
      Certification,
      CompanionRecord,
      CompanionBinding,
      SelfcareRecord,
      BurnoutSettings,
      ConsentSignature,
      // V2026-08-28: 隐私授权 (走 profile 模块, 不做独立 PrivacyModule — 保持模块边界清晰)
      PrivacyAuthorization,
      // V3: UserRepository for CompanionBindingService.listBindings 防 N+1.
      // TypeORM Repository<T> 跨模块不能直接复用, 必须在每个 module 里 forFeature 注册.
      User,
    ]),
    UserModule,
  ],
  controllers: [ProfileController, CertificationController, CompanionController, ExportController, PrivacyAuthorizationController],
  providers: [
    ProfileService,
    NotificationSettingsService,
    MembershipService,
    GrowthReportService,
    CertificationService,
    CompanionRecordService,
    CompanionBindingService,
    SelfcareRecordService,
    BurnoutSettingsService,
    ConsentService,
    ExportService,
    PrivacyAuthorizationService,
    RolesGuard,
  ],
  exports: [
    ProfileService,
    NotificationSettingsService,
    MembershipService,
    GrowthReportService,
    CertificationService,
    CompanionRecordService,
    CompanionBindingService,
    SelfcareRecordService,
    BurnoutSettingsService,
    ConsentService,
    ExportService,
    PrivacyAuthorizationService,
  ],
})
export class ProfileModule {}
