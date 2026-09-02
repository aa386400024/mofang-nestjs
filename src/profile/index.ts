export { ProfileModule } from './profile.module';
export * from './profile.constant';

// ════════════════════════════════════════════════════════════════
// 实体 (供其他模块引用, V3 业务扩展点)
// ════════════════════════════════════════════════════════════════

export { UserProfile, GenderValues, OccupationValues } from './entities/user-profile.entity';
export { NotificationSettings } from './entities/notification-settings.entity';
export { Membership } from './entities/membership.entity';
export { Certification } from './entities/certification.entity';
export { CompanionRecord } from './entities/companion-record.entity';
export { CompanionBinding } from './entities/companion-binding.entity';
export { SelfcareRecord } from './entities/selfcare-record.entity';
export { BurnoutSettings } from './entities/burnout-settings.entity';
export { ConsentSignature } from './entities/consent-signature.entity';

// ════════════════════════════════════════════════════════════════
// Service (供其他模块复用, V3 业务扩展点)
// ════════════════════════════════════════════════════════════════

export { ProfileService } from './providers/profile.service';
export { NotificationSettingsService } from './providers/notification-settings.service';
export { MembershipService } from './providers/membership.service';
export { GrowthReportService } from './providers/growth-report.service';
export { CertificationService } from './providers/certification.service';
export { CompanionRecordService } from './providers/companion-record.service';
export { CompanionBindingService } from './providers/companion-binding.service';
export { SelfcareRecordService } from './providers/selfcare-record.service';
export { BurnoutSettingsService } from './providers/burnout-settings.service';
export { ConsentService } from './providers/consent.service';
