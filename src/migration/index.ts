export { InitUser1700000000000 } from './1700000000000-InitUser';
export { AddUserV2Fields1700000001000 } from './1700000001000-AddUserV2Fields';
export { AddSessionV2Fields1700000002000 } from './1700000002000-AddSessionV2Fields';
export { AddPasswordHistory1700000003000 } from './1700000003000-AddPasswordHistory';
export { AddOAuthIdentity1700000004000 } from './1700000004000-AddOAuthIdentity';
export { AddUserEmailIndex1700000005000 } from './1700000005000-AddUserEmailIndex';
export { AddUserConsent1700000006000 } from './1700000006000-AddUserConsent';

// V3 — Profile 模块 (心塑「我的」Tab 二级页)
export { AddUserProfile1700000007000 } from './1700000007000-AddUserProfile';
export { AddNotificationSettings1700000007001 } from './1700000007001-AddNotificationSettings';
export { AddMemberships1700000007002 } from './1700000007002-AddMemberships';
export { AddCertifications1700000007003 } from './1700000007003-AddCertifications';
export { AddCompanionRecords1700000007004 } from './1700000007004-AddCompanionRecords';
export { AddCompanionBindings1700000007005 } from './1700000007005-AddCompanionBindings';
export { AddSelfcareRecords1700000007006 } from './1700000007006-AddSelfcareRecords';
export { AddBurnoutSettings1700000007007 } from './1700000007007-AddBurnoutSettings';
export { AddConsentSignatures1700000007008 } from './1700000007008-AddConsentSignatures';

// V3 migration 列表直接加到 bin/ormconfig.ts (V2 pattern, 显式列出避免 glob 扫描时序坑).
