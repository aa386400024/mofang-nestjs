export { ProfileModule } from './profile.module.js';
export * from './profile.constant.js';

// ════════════════════════════════════════════════════════════════
// 实体 (供其他模块引用, V3 业务扩展点)
// ════════════════════════════════════════════════════════════════

export { UserProfile, GenderValues, OccupationValues } from './entities/user-profile.entity.js';
export { NotificationSettings } from './entities/notification-settings.entity.js';
export { Membership } from './entities/membership.entity.js';
export { Certification } from './entities/certification.entity.js';
export { CompanionRecord } from './entities/companion-record.entity.js';
export { CompanionBinding } from './entities/companion-binding.entity.js';
export { SelfcareRecord } from './entities/selfcare-record.entity.js';
export { BurnoutSettings } from './entities/burnout-settings.entity.js';
export { ConsentSignature } from './entities/consent-signature.entity.js';

// ════════════════════════════════════════════════════════════════
// Service (供其他模块复用, V3 业务扩展点)
// ════════════════════════════════════════════════════════════════

export { ProfileService } from './providers/profile.service.js';
export { NotificationSettingsService } from './providers/notification-settings.service.js';
export { MembershipService } from './providers/membership.service.js';
export { GrowthReportService } from './providers/growth-report.service.js';
export { CertificationService } from './providers/certification.service.js';
export { CompanionRecordService } from './providers/companion-record.service.js';
export { CompanionBindingService } from './providers/companion-binding.service.js';
export { SelfcareRecordService } from './providers/selfcare-record.service.js';
export { BurnoutSettingsService } from './providers/burnout-settings.service.js';
export { ConsentService } from './providers/consent.service.js';
