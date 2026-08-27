import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RolesGuard } from '../common/guards/roles.guard';
import { UserModule } from '../user/user.module';

import { CertificationController } from './controllers/certification.controller';
import { CompanionController } from './controllers/companion.controller';
import { ProfileController } from './controllers/profile.controller';
import { BurnoutSettings } from './entities/burnout-settings.entity';
import { Certification } from './entities/certification.entity';
import { CompanionBinding } from './entities/companion-binding.entity';
import { CompanionRecord } from './entities/companion-record.entity';
import { ConsentSignature } from './entities/consent-signature.entity';
import { Membership } from './entities/membership.entity';
import { NotificationSettings } from './entities/notification-settings.entity';
import { SelfcareRecord } from './entities/selfcare-record.entity';
import { UserProfile } from './entities/user-profile.entity';

import { BurnoutSettingsService } from './providers/burnout-settings.service';
import { CertificationService } from './providers/certification.service';
import { CompanionBindingService } from './providers/companion-binding.service';
import { CompanionRecordService } from './providers/companion-record.service';
import { ConsentService } from './providers/consent.service';
import { GrowthReportService } from './providers/growth-report.service';
import { MembershipService } from './providers/membership.service';
import { NotificationSettingsService } from './providers/notification-settings.service';
import { ProfileService } from './providers/profile.service';
import { SelfcareRecordService } from './providers/selfcare-record.service';
import { User } from '../user/entities/user.entity';

/**
 * Profile module — 心塑「我的」Tab V2.0 二级页 (大厂企业级 V3).
 *
 * 设计:
 *   - 9 entity 全部通过 TypeOrmModule.forFeature 注册
 *   - 依赖 UserModule 拿 JwtAuthGuard (复用 user 模块鉴权, 不重复造轮子)
 *   - 复用 CommonModule 的 RolesGuard (双角色 endpoint 角色校验)
 *   - 10 service 全部导出 (V3 业务扩展可直接复用, 不用重新 import entity)
 *
 * V3 计划:
 *   - 接 EventBus 触发 audit log / 多端推送
 *   - 暴露 CompanionBinding / SelfcareRecord 给心理业务 (推荐 / 危险干预流)
 *   - 接 BullMQ 跑批 (burnout 预警 / membership 过期扫描)
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
      // V3: UserRepository for CompanionBindingService.listBindings 防 N+1.
      // TypeORM Repository<T> 跨模块不能直接复用, 必须在每个 module 里 forFeature 注册.
      User,
    ]),
    UserModule,
  ],
  controllers: [ProfileController, CertificationController, CompanionController],
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
  ],
})
export class ProfileModule {}
